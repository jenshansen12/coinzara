const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(session({
  secret: process.env.SESSION_SECRET || 'coinzara_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// User Schema with Referral Fields
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  country: { type: String, required: true },
  password: { type: String, required: true },
  securityQuestion: { question: String, answer: String },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  referrals: [{ type: String }],
  referralCount: { type: Number, default: 0 },
  referralBonus: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  depositHistory: { type: Array, default: [] },
  withdrawalHistory: { type: Array, default: [] },
  aiProfit: { type: Number, default: 0 },
  emailVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Chat Message Schema
const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userEmail: String,
  userName: String,
  message: String,
  reply: String,
  isReplied: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  repliedAt: Date
});

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

// Generate referral code from user ID
function generateReferralCode(userId) {
  return userId.toString().slice(-8).toUpperCase();
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/coinzara')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// ========== SIGNUP ==========
app.post('/api/signup', async (req, res) => {
  try {
    const { fullName, email, country, password, securityQ1, securityA1, referralCode } = req.body;
    
    const existing = await User.findOne({ email });
    if (existing) {
      return res.json({ success: false, error: 'Email already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityA1.toLowerCase(), 10);
    
    const user = new User({
      fullName,
      email,
      country,
      password: hashedPassword,
      securityQuestion: { question: securityQ1, answer: hashedAnswer }
    });
    
    await user.save();
    
    user.referralCode = generateReferralCode(user._id);
    
    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (referrer) {
        user.referredBy = referrer.email;
        referrer.referrals.push(email);
        referrer.referralCount += 1;
        await referrer.save();
      }
    }
    
    await user.save();
    
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    
    res.json({ success: true, userId: user._id, fullName: user.fullName, referralCode: user.referralCode });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ========== LOGIN ==========
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.json({ success: false, error: 'Wrong password' });
    }
    
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    
    res.json({ success: true, fullName: user.fullName });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ========== GET CURRENT USER ==========
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ loggedIn: false });
  }
  
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.json({ loggedIn: false });
  }
  
  res.json({
    loggedIn: true,
    userId: user._id,
    fullName: user.fullName,
    email: user.email,
    country: user.country,
    balance: user.balance,
    aiProfit: user.aiProfit,
    referralCode: user.referralCode,
    referralCount: user.referralCount,
    referralBonus: user.referralBonus,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    securityQuestion: user.securityQuestion.question
  });
});

// ========== LOGOUT ==========
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ========== ADMIN - UPDATE BALANCE ==========
app.post('/api/admin/update-balance', async (req, res) => {
  const { adminEmail, adminPassword, userEmail, newBalance, reason } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  const oldBalance = user.balance;
  user.balance = parseFloat(newBalance);
  
  user.depositHistory.push({
    date: new Date(),
    amount: user.balance - oldBalance,
    reason: reason,
    status: 'completed'
  });
  
  await user.save();
  res.json({ success: true, newBalance: user.balance });
});

// ========== ADMIN - ADD REFERRAL BONUS ==========
app.post('/api/admin/add-referral-bonus', async (req, res) => {
  const { adminEmail, adminPassword, userEmail, bonusAmount } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  user.balance += parseFloat(bonusAmount);
  user.referralBonus += parseFloat(bonusAmount);
  await user.save();
  
  res.json({ success: true, newBalance: user.balance, referralBonus: user.referralBonus });
});

// ========== ADMIN - VERIFY USER ==========
app.post('/api/admin/verify-user', async (req, res) => {
  const { adminEmail, adminPassword, userEmail } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  user.emailVerified = true;
  await user.save();
  
  res.json({ success: true, message: 'User verified' });
});

// ========== ADMIN - GET ALL USERS ==========
app.get('/api/admin/users', async (req, res) => {
  const { email, password } = req.query;
  
  if (email !== 'admin@coinzara.org' || password !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const users = await User.find({}, 'fullName email country balance aiProfit referralCode referralCount referralBonus emailVerified createdAt');
  res.json({ success: true, users });
});

// ========== REQUEST WITHDRAWAL ==========
app.post('/api/request-withdrawal', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Not logged in' });
  }
  
  const { amount, network, walletAddress } = req.body;
  const user = await User.findById(req.session.userId);
  
  if (user.balance < amount) {
    return res.json({ success: false, error: 'Insufficient balance' });
  }
  
  user.withdrawalHistory.push({
    date: new Date(),
    amount: parseFloat(amount),
    network,
    walletAddress,
    status: 'pending'
  });
  
  await user.save();
  res.json({ success: true, message: 'Withdrawal request submitted. Processed within 24-48 hours.' });
});

// ========== CHAT ROUTES ==========
app.post('/api/chat/send', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Please login first' });
  }
  
  const { message } = req.body;
  const user = await User.findById(req.session.userId);
  
  const chatMessage = new ChatMessage({
    userId: user._id,
    userEmail: user.email,
    userName: user.fullName,
    message: message,
    isReplied: false
  });
  
  await chatMessage.save();
  res.json({ success: true, message: 'Message sent. Support will reply soon.' });
});

app.get('/api/chat/my-messages', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Not logged in' });
  }
  
  const messages = await ChatMessage.find({ userId: req.session.userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, messages });
});

app.get('/api/admin/chat/messages', async (req, res) => {
  const { adminEmail, adminPassword } = req.query;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const messages = await ChatMessage.find().sort({ createdAt: -1 });
  res.json({ success: true, messages });
});

app.post('/api/admin/chat/reply', async (req, res) => {
  const { adminEmail, adminPassword, messageId, reply } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== 'admin123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const message = await ChatMessage.findById(messageId);
  if (!message) {
    return res.json({ success: false, error: 'Message not found' });
  }
  
  message.reply = reply;
  message.isReplied = true;
  message.repliedAt = new Date();
  await message.save();
  
  res.json({ success: true });
});

// ========== DEBUG ROUTE ==========
app.get('/debug', (req, res) => {
  const fs = require('fs');
  const publicPath = path.join(__dirname, 'public');
  fs.readdir(publicPath, (err, files) => {
    if (err) {
      res.json({ error: err.message, publicPath });
    } else {
      res.json({ publicPath, files });
    }
  });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Coinzara running on http://localhost:${PORT}`);
});