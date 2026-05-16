require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Resend } = require('resend');
const ExcelJS = require('exceljs');

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());

// ==========================================
// 1. KẾT NỐI MONGODB ATLAS
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB Atlas'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ==========================================
// 2. SCHEMAS
// ==========================================
const jobPostingSchema = new mongoose.Schema({
    title: String,
    department: String,
    location: String,
    deadline: Date,
    description: String,
    status: { type: String, default: 'open' },
    totalCV: { type: Number, default: 0 },
    newCV: { type: Number, default: 0 },
    hiredCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const candidateSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    position: String,
    jobPostingId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting' },
    cvUrl: String,
    aiScore: Number,
    isPass: Boolean,
    aiReason: String,
    interviewStatus: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const JobPosting = mongoose.model('JobPosting', jobPostingSchema);
const Candidate = mongoose.model('Candidate', candidateSchema);

// ==========================================
// 3. MULTER
// ==========================================
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// ==========================================
// 4. RESEND
// ==========================================
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

function getPassEmailHTML(name, position) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
            <h1 style="color:#10b981;margin:0;font-size:28px;">🎉 Chúc mừng bạn đã trúng tuyển!</h1>
        </div>
        <div style="background:#fff;padding:30px;border-radius:8px;border-left:4px solid #10b981;">
            <p style="font-size:16px;color:#333;">Xin chào <strong>${name}</strong>,</p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Chúng tôi rất vui mừng thông báo rằng bạn đã <strong style="color:#10b981;">ĐẠT</strong> vòng phỏng vấn cho vị trí <strong>${position}</strong> tại CARBON Billiards.
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Bộ phận Nhân sự sẽ liên hệ với bạn trong thời gian sớm nhất để trao đổi về các bước tiếp theo.
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Trân trọng,<br><strong>Ban Nhân sự CARBON Billiards</strong>
            </p>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:30px;">© 2026 CARBON Billiards. All rights reserved.</p>
    </div>`;
}

function getFailEmailHTML(name, position) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:40px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:30px;">
            <h1 style="color:#e74c3c;margin:0;font-size:28px;">Kết quả phỏng vấn</h1>
        </div>
        <div style="background:#fff;padding:30px;border-radius:8px;border-left:4px solid #e74c3c;">
            <p style="font-size:16px;color:#333;">Xin chào <strong>${name}</strong>,</p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Cảm ơn bạn đã dành thời gian tham gia phỏng vấn cho vị trí <strong>${position}</strong> tại CARBON Billiards.
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Sau khi cân nhắc kỹ lưỡng, chúng tôi rất tiếc phải thông báo rằng hồ sơ của bạn chưa phù hợp với yêu cầu vị trí này tại thời điểm hiện tại.
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Chúng tôi khuyến khích bạn theo dõi các cơ hội khác trong tương lai. Chúc bạn mọi điều tốt đẹp nhất!
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;">
                Trân trọng,<br><strong>Ban Nhân sự CARBON Billiards</strong>
            </p>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:30px;">© 2026 CARBON Billiards. All rights reserved.</p>
    </div>`;
}

// ==========================================
// 5. API JOB POSTINGS
// ==========================================
app.get('/api/jobs', async (req, res) => {
    try {
        const jobs = await JobPosting.find().sort({ createdAt: -1 });
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi lấy danh sách tin tuyển dụng!' });
    }
});

app.get('/api/jobs/open', async (req, res) => {
    try {
        const jobs = await JobPosting.find({ status: 'open' }).sort({ createdAt: -1 });
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi lấy danh sách tin tuyển dụng!' });
    }
});

app.post('/api/jobs', async (req, res) => {
    try {
        const { title, department, location, deadline, description } = req.body;
        const job = new JobPosting({ title, department, location, deadline, description });
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi tạo tin tuyển dụng!' });
    }
});

app.put('/api/jobs/:id', async (req, res) => {
    try {
        const { title, department, location, deadline, description } = req.body;
        const job = await JobPosting.findByIdAndUpdate(req.params.id,
            { title, department, location, deadline, description },
            { new: true }
        );
        if (!job) return res.status(404).json({ error: 'Không tìm thấy tin tuyển dụng!' });
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi cập nhật tin tuyển dụng!' });
    }
});

app.patch('/api/jobs/:id/toggle', async (req, res) => {
    try {
        const job = await JobPosting.findById(req.params.id);
        if (!job) return res.status(404).json({ error: 'Không tìm thấy tin tuyển dụng!' });
        job.status = job.status === 'open' ? 'closed' : 'open';
        await job.save();
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi cập nhật trạng thái!' });
    }
});

// ==========================================
// 6. API PHÂN TÍCH CV BẰNG GEMINI
// ==========================================
app.post('/api/analyze-cv', upload.single('cvFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Không tìm thấy file CV!' });

        const { name, position } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Thiếu GEMINI_API_KEY!' });

        const fileBuffer = fs.readFileSync(req.file.path);
        const base64Data = fileBuffer.toString('base64');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

        const prompt = `Đóng vai là Giám đốc Nhân sự của CARBON Billiards. Hãy phân tích chuyên sâu file CV đính kèm của ứng viên ${name} cho vị trí ${position}.

BẮT BUỘC chấm điểm (thang 100) dựa trên bộ tiêu chí sau:
1. Kinh nghiệm chuyên môn (40 điểm): Khớp với yêu cầu cốt lõi của vị trí ${position}.
2. Kỹ năng & Công cụ (30 điểm): Các phần mềm, máy móc, ngôn ngữ hoặc công cụ chuyên ngành ứng viên thành thạo.
3. Độ ổn định & Trình độ (15 điểm): Thời gian gắn bó ở các công ty cũ và nền tảng học vấn.
4. Trình bày CV (15 điểm): Logic, chuyên nghiệp, không sai chính tả.

Trả về ĐÚNG định dạng JSON thuần túy (tuyệt đối không kèm ký tự markdown):
{"score": <điểm tổng 1-100>, "pros": "<1 câu điểm mạnh cốt lõi>", "cons": "<1 câu điểm yếu hoặc rủi ro lớn nhất>", "decision": "<PASS nếu >= 70, ngược lại FAIL>"}`;

        let resultObj = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await model.generateContent([
                    prompt,
                    { inlineData: { mimeType: 'application/pdf', data: base64Data } }
                ]);
                let rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                resultObj = JSON.parse(rawText);
                break;
            } catch (retryError) {
                if (attempt >= 3) throw retryError;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        fs.unlinkSync(req.file.path);

        res.json({
            aiScore: resultObj.score,
            isPass: resultObj.decision === 'PASS',
            aiReason: '✅ Điểm mạnh: ' + resultObj.pros + ' | ⚠️ Rủi ro: ' + resultObj.cons
        });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Lỗi phân tích CV: ' + error.message });
    }
});

// ==========================================
// 7. API NHẬN CV
// ==========================================
app.post('/api/apply', upload.single('cvFile'), async (req, res) => {
    try {
        const { name, email, phone, position, jobPostingId, aiScore, isPass, aiReason } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Không tìm thấy file CV!' });

        const proto = req.headers['x-forwarded-proto'] || req.protocol;
        const baseUrl = `${proto}://${req.get('host')}`;
        const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

        const newCandidate = new Candidate({
            name, email, phone, position,
            jobPostingId: jobPostingId || null,
            cvUrl: fileUrl,
            aiScore: parseInt(aiScore) || 0,
            isPass: isPass === 'true',
            aiReason: aiReason || 'Đã phân tích xong.',
            createdAt: new Date()
        });

        await newCandidate.save();

        // Tăng CV count cho job posting
        if (jobPostingId) {
            await JobPosting.findByIdAndUpdate(jobPostingId, {
                $inc: { totalCV: 1, newCV: 1 }
            });
        }

        console.log('✅ Đã nhận hồ sơ:', name);
        res.json({ message: 'Nộp hồ sơ thành công!', data: newCandidate });
    } catch (error) {
        console.error('Lỗi API Apply:', error);
        res.status(500).json({ error: 'Lỗi máy chủ Backend!' });
    }
});

// ==========================================
// 8. API LẤY DANH SÁCH ỨNG VIÊN
// ==========================================
app.get('/api/candidates', async (req, res) => {
    try {
        const candidates = await Candidate.find().sort({ createdAt: -1 });
        res.json(candidates);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi lấy dữ liệu!' });
    }
});

// ==========================================
// 9. API KẾT QUẢ PHỎNG VẤN + GỬI EMAIL
// ==========================================
app.post('/api/interview-result', async (req, res) => {
    try {
        const { candidateId, result, scores } = req.body;

        const candidate = await Candidate.findById(candidateId);
        if (!candidate) return res.status(404).json({ error: 'Không tìm thấy ứng viên!' });

        candidate.interviewStatus = result;
        await candidate.save();

        // Nếu PASS → tăng hiredCount
        if (result === 'PASS' && candidate.jobPostingId) {
            await JobPosting.findByIdAndUpdate(candidate.jobPostingId, {
                $inc: { hiredCount: 1, newCV: -1 }
            });
        }

        // Gửi email
        try {
            await resend.emails.send({
                from: EMAIL_FROM,
                to: candidate.email,
                subject: result === 'PASS'
                    ? `🎉 Chúc mừng! Bạn đã trúng tuyển vị trí ${candidate.position}`
                    : `Kết quả phỏng vấn - Vị trí ${candidate.position}`,
                html: result === 'PASS'
                    ? getPassEmailHTML(candidate.name, candidate.position)
                    : getFailEmailHTML(candidate.name, candidate.position)
            });
            console.log(`📧 Đã gửi email ${result} cho ${candidate.email}`);
        } catch (emailError) {
            console.error('Lỗi gửi email:', emailError.message);
        }

        res.json({ message: `Đã cập nhật kết quả ${result} và gửi email!`, candidate });
    } catch (error) {
        console.error('Lỗi interview result:', error);
        res.status(500).json({ error: 'Lỗi xử lý kết quả phỏng vấn!' });
    }
});

// ==========================================
// 10. API XUẤT EXCEL
// ==========================================
app.get('/api/reports/export', async (req, res) => {
    try {
        const candidates = await Candidate.find().sort({ createdAt: -1 });
        const jobs = await JobPosting.find();

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'CARBON ATS';

        // Sheet 1: Tổng quan
        const overviewSheet = workbook.addWorksheet('Tổng quan');
        overviewSheet.columns = [
            { header: 'Chỉ số', key: 'metric', width: 30 },
            { header: 'Giá trị', key: 'value', width: 20 }
        ];
        const totalCV = candidates.length;
        const totalHired = candidates.filter(c => c.interviewStatus === 'PASS').length;
        const totalCost = totalCV * 125000 + 5000000;
        overviewSheet.addRow({ metric: 'Tổng số CV nhận', value: totalCV });
        overviewSheet.addRow({ metric: 'Tổng số đã tuyển', value: totalHired });
        overviewSheet.addRow({ metric: 'Tổng chi phí (VNĐ)', value: totalCost.toLocaleString('vi-VN') });
        overviewSheet.addRow({ metric: 'Cost Per Hire (VNĐ)', value: totalHired > 0 ? Math.round(totalCost / totalHired).toLocaleString('vi-VN') : 'N/A' });

        // Sheet 2: Danh sách ứng viên
        const candidateSheet = workbook.addWorksheet('Danh sách ứng viên');
        candidateSheet.columns = [
            { header: 'Họ tên', key: 'name', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'SĐT', key: 'phone', width: 15 },
            { header: 'Vị trí', key: 'position', width: 25 },
            { header: 'Điểm AI', key: 'aiScore', width: 10 },
            { header: 'AI Pass', key: 'isPass', width: 10 },
            { header: 'Phỏng vấn', key: 'interviewStatus', width: 15 },
            { header: 'Ngày nộp', key: 'createdAt', width: 20 }
        ];
        candidates.forEach(c => {
            candidateSheet.addRow({
                name: c.name,
                email: c.email || '',
                phone: c.phone,
                position: c.position,
                aiScore: c.aiScore,
                isPass: c.isPass ? 'PASS' : 'FAIL',
                interviewStatus: c.interviewStatus || 'pending',
                createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString('vi-VN') : ''
            });
        });

        // Sheet 3: Thống kê theo vị trí
        const statsSheet = workbook.addWorksheet('Thống kê theo vị trí');
        statsSheet.columns = [
            { header: 'Vị trí', key: 'position', width: 25 },
            { header: 'Tổng CV', key: 'total', width: 12 },
            { header: 'Pass AI', key: 'passAI', width: 12 },
            { header: 'Đã tuyển', key: 'hired', width: 12 }
        ];
        const positionMap = {};
        candidates.forEach(c => {
            if (!positionMap[c.position]) positionMap[c.position] = { total: 0, passAI: 0, hired: 0 };
            positionMap[c.position].total++;
            if (c.isPass) positionMap[c.position].passAI++;
            if (c.interviewStatus === 'PASS') positionMap[c.position].hired++;
        });
        Object.entries(positionMap).forEach(([pos, stats]) => {
            statsSheet.addRow({ position: pos, ...stats });
        });

        // Style header rows
        [overviewSheet, candidateSheet, statsSheet].forEach(sheet => {
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=carbon-ats-report.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Lỗi export Excel:', error);
        res.status(500).json({ error: 'Lỗi xuất báo cáo!' });
    }
});

// ==========================================
// 11. BẬT MÁY CHỦ
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 CARBON ATS Backend đang chạy tại cổng ${PORT}`);
});
