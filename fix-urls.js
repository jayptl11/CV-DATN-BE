require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

const candidateSchema = new mongoose.Schema({
    name: String, phone: String, position: String, cvUrl: String,
    aiScore: Number, isPass: Boolean, aiReason: String,
    createdAt: { type: Date, default: Date.now }
});

const Candidate = mongoose.model('Candidate', candidateSchema);

async function fixUrls() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Đã kết nối MongoDB');

        const candidates = await Candidate.find({ cvUrl: { $regex: /^http:\/\// } });
        console.log(`📄 Tìm thấy ${candidates.length} bản ghi cần sửa`);

        for (const cand of candidates) {
            cand.cvUrl = cand.cvUrl.replace('http://', 'https://');
            await cand.save();
        }

        console.log(`✅ Đã sửa ${candidates.length} bản ghi: http → https`);

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi:', error);
        process.exit(1);
    }
}

fixUrls();
