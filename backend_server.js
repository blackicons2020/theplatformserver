/**
 * The Platform - Backend Server Code
 * database: MongoDB Atlas
 * host: Vercel (serverless)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB Connection (cached for serverless)
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGODB_URI);
  isConnected = true;
  console.log('MongoDB connected successfully');
}
app.use(async (req, res, next) => {
  await connectDB();
  next();
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
  clientName:    { type: String, required: true },
  email:         { type: String, required: true },
  plan:          { type: String, required: true },
  amount:        Number,
  status:        { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
  dateSubmitted: { type: Date, default: Date.now },
  receiptImage:  String,
  adImage:       String,
  adContent:     String,
  adUrl:         String,
  adHeadline:    String,
  adContentFile: String
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
  status:  { type: String, default: 'unread' }
}, jsonOptions);

const SupportMessage = mongoose.model('SupportMessage', supportSchema);

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('The Platform API is running successfully! 🚀');
});

// --- ARTICLE ROUTES ---

// 1. Get All Published Articles
app.get('/api/articles', async (req, res) => {
  try {
    const articles = await Article.find({ status: 'published' }).sort({ date: -1 });
    res.json(articles);
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

// Export for Vercel serverless
module.exports = app;