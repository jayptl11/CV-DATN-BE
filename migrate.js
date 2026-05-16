require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
const RAILWAY_URL = 'https://cv-datn-be-production.up.railway.app';

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

async function migrate() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Đã kết nối MongoDB');

        const data = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
        console.log(`📄 Đọc được ${data.length} bản ghi từ database.json`);

        // Xóa dữ liệu cũ (nếu có)
        await Candidate.deleteMany({});
        console.log('🗑️ Đã xóa dữ liệu cũ trong MongoDB');

        // Chuyển đổi cvUrl từ localhost sang Railway URL
        const records = data.map(item => ({
            name: item.name,
            phone: item.phone,
            position: item.position,
            cvUrl: item.cvUrl
                ? item.cvUrl.replace(/http:\/\/localhost:\d+/, RAILWAY_URL)
                    .replace(/http:\/\/127\.0\.0\.1:\d+/, RAILWAY_URL)
                : '',
            aiScore: item.aiScore,
            isPass: item.isPass,
            aiReason: item.aiReason,
            createdAt: new Date(item.createdAt)
        }));

        await Candidate.insertMany(records);
        console.log(`✅ Đã migrate ${records.length} bản ghi vào MongoDB`);

        await mongoose.disconnect();
        console.log('🔌 Đã ngắt kết nối MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('❌ Lỗi migrate:', error);
        process.exit(1);
    }
}

migrate();
