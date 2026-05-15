require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// CORS: chỉ cho phép frontend domain truy cập
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());

// ==========================================
// 1. KẾT NỐI MONGODB ATLAS
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB Atlas'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// Schema cho ứng viên
const candidateSchema = new mongoose.Schema({
    name: String,
    phone: String,
    position: String,
    cvUrl: String,
    aiScore: Number,
    isPass: Boolean,
    aiReason: String,
    createdAt: { type: Date, default: Date.now }
});

const Candidate = mongoose.model('Candidate', candidateSchema);

// ==========================================
// 2. CẤU HÌNH MULTER NHẬN FILE
// ==========================================
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Phục vụ file tĩnh (uploads)
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// ==========================================
// 3. API PHÂN TÍCH CV BẰNG GEMINI (CHẠY Ở BACKEND)
// ==========================================
app.post('/api/analyze-cv', upload.single('cvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Không tìm thấy file CV!' });
        }

        const { name, position } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'Thiếu GEMINI_API_KEY trên server!' });
        }

        // Đọc file PDF và convert sang base64
        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');

        // Gọi Gemini API
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

        const prompt = `Đóng vai là Giám đốc Nhân sự của CARBON Billiards. Hãy phân tích chuyên sâu file CV đính kèm của ứng viên ${name} cho vị trí ${position}.

BẮT BUỘC chấm điểm (thang 100) dựa trên bộ tiêu chí sau:
1. Kinh nghiệm chuyên môn (40 điểm): Khớp với yêu cầu cốt lõi của vị trí ${position}.
2. Kỹ năng & Công cụ (30 điểm): Các phần mềm, máy móc, ngôn ngữ hoặc công cụ chuyên ngành ứng viên thành thạo.
3. Độ ổn định & Trình độ (15 điểm): Thời gian gắn bó ở các công ty cũ và nền tảng học vấn.
4. Trình bày CV (15 điểm): Logic, chuyên nghiệp, không sai chính tả.

Trả về ĐÚNG định dạng JSON thuần túy (tuyệt đối không kèm ký tự markdown như \`\`\`json):
{"score": <điểm tổng 1-100>, "pros": "<1 câu điểm mạnh cốt lõi>", "cons": "<1 câu điểm yếu hoặc rủi ro lớn nhất>", "decision": "<PASS nếu >= 70, ngược lại FAIL>"}`;

        // Retry logic (tối đa 3 lần)
        let resultObj = null;
        let maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await model.generateContent([
                    prompt,
                    {
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: base64Data
                        }
                    }
                ]);

                const response = result.response;
                let rawText = response.text();
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                resultObj = JSON.parse(rawText);
                break;

            } catch (retryError) {
                console.warn(`Lần thử ${attempt} thất bại: ${retryError.message}`);
                if (attempt >= maxRetries) {
                    throw retryError;
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Xóa file tạm sau khi phân tích xong
        fs.unlinkSync(filePath);

        res.status(200).json({
            aiScore: resultObj.score,
            isPass: resultObj.decision === 'PASS',
            aiReason: '✅ Điểm mạnh: ' + resultObj.pros + ' | ⚠️ Rủi ro: ' + resultObj.cons
        });

    } catch (error) {
        console.error('Lỗi API Analyze CV:', error);
        // Xóa file tạm nếu có lỗi
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Lỗi phân tích CV: ' + error.message });
    }
});

// ==========================================
// 4. API NHẬN CV TỪ FRONTEND (ĐÃ CÓ AI SCORE)
// ==========================================
app.post('/api/apply', upload.single('cvFile'), async (req, res) => {
    try {
        const { name, phone, position, aiScore, isPass, aiReason } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'Không tìm thấy file CV!' });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

        const newCandidate = new Candidate({
            name: name,
            phone: phone,
            position: position,
            cvUrl: fileUrl,
            aiScore: parseInt(aiScore) || 0,
            isPass: isPass === 'true',
            aiReason: aiReason || 'Đã phân tích xong.',
            createdAt: new Date()
        });

        await newCandidate.save();

        console.log('✅ Đã nhận và lưu hồ sơ:', name);
        res.status(200).json({ message: 'Nộp hồ sơ thành công!', data: newCandidate });

    } catch (error) {
        console.error('Lỗi API Apply:', error);
        res.status(500).json({ error: 'Lỗi máy chủ Backend!' });
    }
});

// ==========================================
// 5. API LẤY DANH SÁCH ỨNG VIÊN
// ==========================================
app.get('/api/candidates', async (req, res) => {
    try {
        const candidates = await Candidate.find().sort({ createdAt: -1 });
        res.status(200).json(candidates);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi lấy dữ liệu!' });
    }
});

// ==========================================
// 6. BẬT MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 CARBON ATS Backend đang chạy tại cổng ${PORT}`);
});
