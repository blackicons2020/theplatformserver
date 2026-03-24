/**
 * The Platform - Backend Server Code
 * database: MongoDB Atlas
 * host: Vercel (serverless)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const sharp = require('sharp');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB Connection (cached for serverless)
mongoose.set('bufferCommands', false);
async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is not set');
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 15000,
  });
  console.log('MongoDB connected successfully');
}
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err.message);
    res.status(500).json({ message: 'Database connection error. Check server environment variables.' });
  }
});

// Helper: compress a base64 image to a small thumbnail
async function makeThumb(base64, width = 400) {
  try {
    const match = base64.match(/^data:image\/\w+;base64,(.+)$/);
    if (!match) return '';
    const buf = Buffer.from(match[1], 'base64');
    const out = await sharp(buf).resize(width, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 55 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch { return ''; }
}
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err.message);
    res.status(500).json({ message: 'Database connection error. Check server environment variables.' });
  }
});

// --- Schemas & Models ---

const jsonOptions = { toJSON: { virtuals: true }, toObject: { virtuals: true } };

const articleSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  subHeadline: { type: String, default: '' },
  category:    { type: String, required: true },
  author:      { type: String, default: 'Citizen Reporter' },
  date:        { type: Date, default: Date.now },
  image:       String,
  excerpt:     String,
  content:     String,
  views:       { type: Number, default: 0 },
  status:      { type: String, enum: ['pending', 'published', 'rejected'], default: 'pending' },
  isBreaking:  { type: Boolean, default: false }
}, jsonOptions);

const Article = mongoose.model('Article', articleSchema);

const adSchema = new mongoose.Schema({
  clientName:       { type: String, required: true },
  email:            { type: String, required: true },
  plan:             { type: String, required: true },
  amount:           Number,
  status:           { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
  dateSubmitted:    { type: Date, default: Date.now },
  receiptImage:     String,
  adImage:          String,
  adContent:        String,
  adUrl:            String,
  adHeadline:       String,
  adContentFile:    String,
  paymentReference: { type: String, unique: true, sparse: true }
}, jsonOptions);

const Ad = mongoose.model('Ad', adSchema);

const commentSchema = new mongoose.Schema({
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  author:    { type: String, required: true },
  email:     { type: String, required: true },
  content:   { type: String, required: true },
  date:      { type: Date, default: Date.now }
}, jsonOptions);

const Comment = mongoose.model('Comment', commentSchema);

const supportSchema = new mongoose.Schema({
  name:    { type: String, required: true },
  email:   { type: String, required: true },
  subject: String,
  message: { type: String, required: true },
  date:    { type: Date, default: Date.now },
  status:  { type: String, default: 'unread' },
  reply:   { type: String, default: '' },
  replyDate: Date
}, jsonOptions);

const SupportMessage = mongoose.model('SupportMessage', supportSchema);

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('The Platform API is running successfully! 🚀');
});

// Default OG image for social previews
app.get('/api/og-default-image', async (req, res) => {
  try {
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#008751"/>
      <text x="600" y="280" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">The People's Platform</text>
      <text x="600" y="360" font-family="Arial,sans-serif" font-size="36" fill="#c0f0d0" text-anchor="middle">Empowering voices</text>
      <rect y="590" width="1200" height="40" fill="#006040"/>
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, s-maxage=604800');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Error');
  }
});

// --- ARTICLE ROUTES ---

// 1. Get All Published Articles (lightweight – excludes content & image)
app.get('/api/articles', async (req, res) => {
  try {
    const articles = await Article.find({ status: 'published' })
      .select('-content -image')
      .sort({ date: -1 });
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 1a. Batch thumbnails – returns compressed images for a list of article IDs
app.post('/api/articles/thumbnails', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json({});
    const limited = ids.slice(0, 20);
    const articles = await Article.find({ _id: { $in: limited } }).select('image');
    const result = {};
    await Promise.all(articles.map(async (a) => {
      if (a.image) result[a._id.toString()] = await makeThumb(a.image);
    }));
    res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 1b. Get Single Article (full detail with image & content)
app.get('/api/articles/:id', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.set('Cache-Control', 'no-cache');
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 1c. Get Article Thumbnail Only
app.get('/api/articles/:id/image', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id).select('image');
    if (!article) return res.status(404).json({ message: 'Not found' });
    const thumb = article.image ? await makeThumb(article.image) : '';
    res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.json({ image: thumb });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 1d. Serve Article Image as binary (for OG tags / social previews)
app.get('/api/articles/:id/og-image', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id).select('image');
    if (!article || !article.image) return res.status(404).send('No image');
    const match = article.image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return res.status(404).send('Invalid image');
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    // Resize for social previews (1200x630 is ideal for OG)
    const resized = await sharp(buffer).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.send(resized);
  } catch (err) {
    res.status(500).send('Error');
  }
});

// 1e. Get Article OG metadata (lightweight - for social link previews)
app.get('/api/articles/:id/og', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id).select('title subHeadline excerpt category author image');
    if (!article) return res.status(404).json({ message: 'Not found' });
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.json({
      title: article.title,
      description: article.subHeadline || article.excerpt || '',
      category: article.category,
      author: article.author,
      hasImage: !!article.image
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Submit New Article
app.post('/api/articles', async (req, res) => {
  const { title, subHeadline, category, author, image, excerpt, content, status } = req.body;
  try {
    const article = new Article({
      title, subHeadline, category,
      author: author || 'Citizen Reporter',
      image, excerpt, content,
      status: status || 'pending'
    });
    const saved = await article.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 3. Admin: Get Pending Articles
app.get('/api/admin/pending-articles', async (req, res) => {
  try {
    const articles = await Article.find({ status: 'pending' }).sort({ date: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Admin: Approve Article
app.patch('/api/admin/articles/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { isBreaking } = req.body;
  try {
    const article = await Article.findByIdAndUpdate(
      id,
      { status: 'published', isBreaking: isBreaking || false, date: new Date() },
      { new: true }
    );
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Admin: Update Article
app.put('/api/articles/:id', async (req, res) => {
  const { id } = req.params;
  const { title, subHeadline, category, author, image, content, isBreaking } = req.body;
  try {
    const article = await Article.findByIdAndUpdate(
      id,
      { title, subHeadline, category, author, image, content, isBreaking },
      { new: true }
    );
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 6. Admin: Delete Article
app.delete('/api/articles/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await Article.findByIdAndDelete(id);
    res.json({ message: 'Article deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- AD ROUTES ---

// 7. Submit Advertisement
app.post('/api/ads', async (req, res) => {
  const { clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline, adContentFile } = req.body;
  try {
    const ad = new Ad({ clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline, adContentFile });
    const saved = await ad.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 8. Get Active Ads
app.get('/api/ads/active', async (req, res) => {
  try {
    const ads = await Ad.find({ status: 'active' });
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(ads);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8b. Admin: Get All Ads
app.get('/api/admin/ads', async (req, res) => {
  try {
    const ads = await Ad.find().sort({ dateSubmitted: -1 });
    res.json(ads);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 9. Admin: Approve Ad
app.patch('/api/admin/ads/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const ad = await Ad.findByIdAndUpdate(id, { status: 'active' }, { new: true });
    if (!ad) return res.status(404).json({ message: 'Ad not found' });
    res.json(ad);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 9b. Admin: Edit Ad
app.put('/api/admin/ads/:id', async (req, res) => {
  const { id } = req.params;
  const { clientName, email, plan, amount, adHeadline, adContent, adUrl, status, adImage } = req.body;
  try {
    const update = { clientName, email, plan, amount, adHeadline, adContent, adUrl, status };
    if (adImage) update.adImage = adImage;
    const ad = await Ad.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    );
    if (!ad) return res.status(404).json({ message: 'Ad not found' });
    res.json(ad);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 9c. Admin: Delete Ad
app.delete('/api/admin/ads/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const ad = await Ad.findByIdAndDelete(id);
    if (!ad) return res.status(404).json({ message: 'Ad not found' });
    res.json({ message: 'Ad deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- PAYMENT ROUTES ---

// Verify Paystack transaction and save ad
app.post('/api/payment/verify-ad', async (req, res) => {
  const { reference, clientName, email, plan, amount, adImage, adHeadline, adContent, adUrl, adContentFile } = req.body;
  if (!reference) return res.status(400).json({ message: 'Payment reference required' });
  try {
    // Verify with Paystack
    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status || paystackData.data?.status !== 'success') {
      return res.status(402).json({ message: 'Payment not confirmed. Please contact support.' });
    }
    // Check amount matches (Paystack returns amount in kobo)
    const paidKobo = paystackData.data.amount;
    const expectedKobo = amount * 100;
    if (paidKobo < expectedKobo) {
      return res.status(402).json({ message: `Underpayment detected. Expected ₦${amount.toLocaleString()}.` });
    }
    // Check reference not already used
    const existing = await Ad.findOne({ paymentReference: reference });
    if (existing) return res.status(409).json({ message: 'This payment reference has already been used.' });
    // Save ad
    const ad = new Ad({
      clientName, email, plan, amount,
      paymentReference: reference,
      adImage, adHeadline, adContent, adUrl, adContentFile,
      status: 'pending'
    });
    const saved = await ad.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ message: 'Verification failed. Please try again or contact support.' });
  }
});

// --- COMMENT ROUTES ---

// Admin: Post Ad directly (no payment required) — immediately active
app.post('/api/admin/ads', async (req, res) => {
  const { clientName, email, plan, amount, adImage, adHeadline, adContent, adUrl, adContentFile } = req.body;
  try {
    const ad = new Ad({
      clientName: clientName || 'Admin',
      email: email || 'admin@theplatform.ng',
      plan, amount: amount || 0,
      adImage, adHeadline, adContent, adUrl, adContentFile,
      status: 'active'
    });
    const saved = await ad.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- COMMENT ROUTES ---

// 10. Post Comment
app.post('/api/comments', async (req, res) => {
  const { articleId, author, email, content } = req.body;
  try {
    const comment = new Comment({ articleId, author, email, content });
    const saved = await comment.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 11. Get Comments for Article
app.get('/api/articles/:id/comments', async (req, res) => {
  const { id } = req.params;
  try {
    const comments = await Comment.find({ articleId: id }).sort({ date: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- SUPPORT ROUTES ---

// 12. Submit Support Message
app.post('/api/support', async (req, res) => {
  const { name, email, subject, message } = req.body;
  try {
    const msg = new SupportMessage({ name, email, subject, message });
    await msg.save();
    res.status(201).json({ message: 'Support message sent' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 13. Admin: Get Support Messages
app.get('/api/admin/support', async (req, res) => {
  try {
    const messages = await SupportMessage.find().sort({ date: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 14. Admin: Reply to support message
app.patch('/api/admin/support/:id/reply', async (req, res) => {
  const { id } = req.params;
  const { reply } = req.body;
  try {
    const msg = await SupportMessage.findByIdAndUpdate(
      id,
      { reply, replyDate: new Date(), status: 'replied' },
      { new: true }
    );
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 15. User: Check support replies by email
app.get('/api/support/replies', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: 'Email required' });
  try {
    const messages = await SupportMessage.find({ email, reply: { $ne: '' } }).sort({ replyDate: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export for Vercel serverless
module.exports = app;