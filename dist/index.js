"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// Scraper
const agent_twitter_client_1 = require("agent-twitter-client");
// Gemini
const genai_1 = require("@google/genai");
const telegraf_1 = require("telegraf");
const filters_1 = require("telegraf/filters");
// Functions
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const main_json_1 = __importDefault(require("./character/main.json"));
const bottleneck_1 = __importDefault(require("bottleneck"));
dotenv_1.default.config();
const apiKey = process.env.GEMINI_API_KEY || "";
const aiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const scraper = new agent_twitter_client_1.Scraper();
const genAI = new genai_1.GoogleGenAI({ apiKey });
// =========================================
// State persistence
// =========================================
const STATE_PATH = "./state.json";
// =========================================
// Embedding Helpers
// =========================================
function embedBatch(texts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const result = yield genAI.models.embedContent({
            model: "gemini-embedding-001", // official embedding model
            contents: texts,
            config: {
                taskType: "SEMANTIC_SIMILARITY",
            },
        });
        if (result.embeddings) {
            return (_a = result.embeddings) === null || _a === void 0 ? void 0 : _a.map((e) => e.values);
        }
        else {
            return [];
        }
    });
}
// Allow 100 embeddings per minute
const limiter = new bottleneck_1.default({
    reservoir: 100, // number of tokens available
    reservoirRefreshAmount: 100,
    reservoirRefreshInterval: 60 * 1000, // refresh every minute
    minTime: 600, // at least 1 call every 600ms
});
function embedText(text) {
    return __awaiter(this, void 0, void 0, function* () {
        return limiter.schedule(() => __awaiter(this, void 0, void 0, function* () {
            const result = yield genAI.models.embedContent({
                model: "gemini-embedding-001",
                contents: [text],
                config: { taskType: "SEMANTIC_SIMILARITY" },
            });
            if (result.embeddings) {
                return result.embeddings[0].values;
            }
            return [];
        }));
    });
}
function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (normA * normB);
}
// =========================================
// Knowledge Base
// =========================================
const KB_PATH = "./character/knowledge/chronicles_library.json";
const KB_EMBED_PATH = "./character/knowledge/chronicles_with_embeddings.json";
let kb = [];
function loadKB() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync(KB_EMBED_PATH)) {
            // ✅ Load pre-computed embeddings
            kb = JSON.parse(fs_1.default.readFileSync(KB_EMBED_PATH, "utf8"));
            console.log(`📦 Loaded ${kb.length} scripture verses (with embeddings).`);
            return;
        }
        if (fs_1.default.existsSync(KB_PATH)) {
            const raw = JSON.parse(fs_1.default.readFileSync(KB_PATH, "utf8"));
            if (raw.library && Array.isArray(raw.library)) {
                for (const book of raw.library) {
                    const sectionName = book.section;
                    console.log(sectionName);
                    for (const chapter of book.chapters || []) {
                        const chapterNum = chapter.chapter;
                        const chapterTitle = chapter.title;
                        for (const verse of chapter.verses || []) {
                            const text = verse.text;
                            const embedding = yield embedText(text);
                            kb.push({
                                section: sectionName,
                                chapter: chapterNum,
                                chapterTitle,
                                verse: verse.verse,
                                text,
                                embedding,
                            });
                        }
                    }
                }
                fs_1.default.writeFileSync(KB_EMBED_PATH, JSON.stringify(kb, null, 2));
                console.log(`💾 Saved ${kb.length} verses with embeddings.`);
            }
        }
        else {
            console.warn("⚠️ No chronicles_library.json found, knowledge base empty.");
        }
    });
}
// retrieval
function querySimilarity(q, doc) {
    const qWords = new Set(q.toLowerCase().split(/\W+/));
    const dWords = new Set(doc.toLowerCase().split(/\W+/));
    let overlap = 0;
    qWords.forEach((w) => {
        if (dWords.has(w))
            overlap++;
    });
    return overlap;
}
function retrieve(query, k) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!kb.length)
            return [];
        const queryEmbedding = yield embedText(query);
        return kb
            .map((d) => ({
            reference: `Book ${d.section}, Chapter ${d.chapter} (${d.chapterTitle}), Verse ${d.verse}`,
            text: d.text,
            score: d.embedding ? cosineSimilarity(queryEmbedding, d.embedding) : 0,
        }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map((d) => `${d.text}\n— ${d.reference}`);
    });
}
// =========================================
// Style + Filters
// =========================================
function stripHashtagsEmojis(text) {
    return text
        .replace(/#\w+/g, "")
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}
function hardLengthLimit(text, limit = 280) {
    return text.length <= limit ? text : text.slice(0, limit);
}
function finalStylePass(text) {
    let out = stripHashtagsEmojis(text);
    out = out.replace(/\b(click|subscribe|follow|retweet|like|share)\b/gi, "consider");
    return hardLengthLimit(out);
}
function isBigAccount(tweet) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const user = yield scraper.getProfile(tweet.username);
        return ((_a = user.followersCount) !== null && _a !== void 0 ? _a : 0) > 5000; // threshold, adjust as needed
    });
}
function looksLikeScam(tweet) {
    var _a, _b, _c, _d, _e;
    if (!(tweet === null || tweet === void 0 ? void 0 : tweet.text))
        return false;
    const text = tweet.text.toLowerCase();
    // 🚨 Weighted red flags
    let score = 0;
    // 1️⃣ Suspicious keywords (fuzzy match)
    const scamKeywords = [
        "congrats",
        "you('ve| have) been selected",
        "grab( your| ur)? chance",
        "see more",
        "airdrop",
        "claim reward",
        "free mint",
        "100% safe",
        "guaranteed",
        "limited offer",
        "investment opportunity",
        "send eth",
        "double your",
        "click here",
        "exclusive deal",
        "urgent",
        "act now",
        "drop your address",
    ];
    if (scamKeywords.some((kw) => new RegExp(kw, "i").test(text)))
        score += 2; // strong signal
    // 2️⃣ Suspicious URLs
    const urlPatterns = [
        /\.cn\//,
        /\.ru\//,
        /bit\.ly/,
        /tinyurl/,
        /rebrand\.ly/,
        /free-[a-z0-9]+/,
    ];
    if ((_a = tweet.urls) === null || _a === void 0 ? void 0 : _a.some((url) => urlPatterns.some((p) => p.test(url.expanded_url))))
        score += 3; // very strong signal
    // 3️⃣ Excessive mentions or hashtags
    if (((_c = (_b = tweet.mentions) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0) > 5)
        score += 1;
    if (((_e = (_d = tweet.hashtags) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) > 5)
        score += 1;
    // 4️⃣ Shouting / all caps
    const plainText = text.replace(/\W/g, "");
    if (plainText.length > 20 && plainText === plainText.toUpperCase())
        score += 1;
    // 5️⃣ Crypto addresses
    if (/\b(0x[a-f0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/.test(text))
        score += 3;
    // 6️⃣ Optional: suspicious punctuation patterns (!!!, $$$, ***, etc.)
    if (/[!$*]{3,}/.test(text))
        score += 1;
    console.log(`Tweet ID ${tweet.id} scam score: ${score}`);
    // Threshold: adjust as needed
    return score >= 5; // need combined strong signals
}
// =========================================
// Prompting
// =========================================
const SYSTEM_PROMPT = `
You are ${main_json_1.default.name}, an AI scribe for “The Chronicles of the HODL Scriptures.”
Write in a voice reminiscent of ancient scripture: solemn, clear, and wise—
but lightly witty, never rash. Offer meaning, clarity, and direction.
Do NOT use hashtags. Avoid emojis. Do NOT use em dashes. Keep under 200 characters unless asked otherwise.
Prefer short, luminous lines. Natural human cadence. At the end of your response state the name of the book being referenced, the chapter and the verse(e.g WAGMI Wisdom 5:2). Use the most appropriate scripture and in case of consecutive verses state them(e.g  WAGMI Wisdom 5:2-5)
Shorten book names if possible, for example, The Book Of WAGMI Wisdom becomes WAGMI Wisdom. 

When data is uncertain, do not invent specifics. Speak in timeless language:
- use phrases like “of late,” “in these days,” “in due season,” “it is meet to say”.
- Avoid exact dates, precise numbers, or unverifiable claims.
- No marketing tone.

If replying, address the user’s point with warmth and parable-like brevity.
If composing an original tweet, ground it in the knowledge retrieved.
`;
const FEW_SHOTS = [
    ["user", "Markets fell and I’m scared."],
    [
        "assistant",
        "Be not dismayed by the red sea thou beholdest; for tides go out that they may return. Steady thy hand, and number thy days, not thy candles.",
    ],
    ["user", "What’s the wisdom for new builders?"],
    [
        "assistant",
        "Begin with small obedience: ship today, refine tomorrow. For the chain remembereth faithful labor, and the gate openeth to the patient.",
    ],
];
function writeInVoice(topicOrReply_1) {
    return __awaiter(this, arguments, void 0, function* (topicOrReply, isReply = false) {
        const docs = yield retrieve(topicOrReply, 1);
        let scriptureRef = "";
        if (docs.length > 0) {
            const [text, reference] = docs[0].split("\n— ");
            scriptureRef = reference ? `\n— ${reference}` : "";
        }
        const ctx = docs.length
            ? `Context from HODL scriptures:\n${docs.join("\n\n")}`
            : "";
        const userPrompt = isReply
            ? `Compose a brief reply in-voice to this tweet:\n${topicOrReply}`
            : `Compose an original tweet in-voice about:\n${topicOrReply}`;
        const prompt = `${ctx}\n\n${userPrompt}`;
        let messages = [];
        for (const shots of FEW_SHOTS) {
            const message = {
                role: shots[0],
                message: shots[1],
            };
            messages.push(message);
        }
        const result = yield genAI.models.generateContent({
            model: aiModel,
            contents: prompt,
            config: {
                thinkingConfig: {
                    thinkingBudget: 0, // Disables thinking
                },
                systemInstruction: SYSTEM_PROMPT,
            },
        });
        let text = result.text;
        text = finalStylePass(`${text}`);
        return text;
    });
}
// =========================================
// Twitter Actions
// =========================================
function postTweet(text) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!text.trim())
            return null;
        console.log("Posting tweet:", text);
        try {
            const tweet = yield scraper.sendTweet(text);
            const res = yield tweet.json();
            return (_a = res.id) !== null && _a !== void 0 ? _a : null;
        }
        catch (e) {
            console.error("Tweet error:", e);
            return null;
        }
    });
}
function replyToTweet(text, replyId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log("Posting tweet:", text);
        try {
            const tweet = yield scraper.sendTweet(text, replyId);
            const res = yield tweet.json();
            return (_a = res.id) !== null && _a !== void 0 ? _a : null;
        }
        catch (e) {
            console.error("Reply error:", e);
            return null;
        }
    });
}
function quoteTweet(text, quoteId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const tweet = yield scraper.sendQuoteTweet(text, quoteId);
            const res = yield tweet.json();
            return (_a = res.id) !== null && _a !== void 0 ? _a : null;
        }
        catch (e) {
            console.error("Quote Tweet error:", e);
            return null;
        }
    });
}
// =========================================
// Scheduler tasks
// =========================================
function scheduledOriginalPosts() {
    return __awaiter(this, void 0, void 0, function* () {
        const topics = [
            "endurance through volatile seasons",
            "wisdom of building slowly",
            "the snares of greed and the frost of fear",
            "patience in cycles and DCA",
            "community, humility, and long memory of chains",
        ];
        const topic = topics[Math.floor(Math.random() * topics.length)];
        const text = yield writeInVoice(topic, false);
        yield postTweet(text);
    });
}
function scheduledMentionsReply() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const url = `https://api.x.com/2/users/${process.env.ID}/mentions?max_results=5`;
            const options = {
                method: "GET",
                headers: { Authorization: `Bearer ${process.env.BEARER}` },
                body: undefined,
            };
            let mentions = [];
            try {
                const response = yield fetch(url, options);
                const data = yield response.json();
                console.log(data);
                mentions = data.data;
            }
            catch (error) {
                console.error(error);
            }
            console.log(mentions);
            const file = "replied.json";
            let replied = [];
            if (fs_1.default.existsSync(file)) {
                replied = JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
            }
            const toReply = mentions.filter((tweet) => !replied.some((item) => item.id === tweet.id));
            let newReplies = [];
            for (const m of toReply) {
                if (((_a = m.text) === null || _a === void 0 ? void 0 : _a.trim()) === "@Domistro19" && m.isReply === true) {
                    const tweet = yield scraper.getTweet(m.id);
                    const topTweet = yield scraper.getTweet(tweet === null || tweet === void 0 ? void 0 : tweet.inReplyToStatusId);
                    const replyText = yield writeInVoice(topTweet === null || topTweet === void 0 ? void 0 : topTweet.text, true);
                    yield quoteTweet(replyText, topTweet === null || topTweet === void 0 ? void 0 : topTweet.id);
                }
                else {
                    const replyText = yield writeInVoice(m.text, true);
                    yield replyToTweet(replyText, m.id);
                    newReplies.push({ id: m.id });
                }
            }
            fs_1.default.writeFileSync(file, JSON.stringify([...mentions, ...newReplies], null, 2));
        }
        catch (e) {
            console.error("Mentions error:", e);
        }
    });
}
const QUOTED_FILE = "./quoted.json";
function scheduledScamWatcher() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Load already quoted tweets
            let quoted = [];
            if (fs_1.default.existsSync(QUOTED_FILE)) {
                quoted = JSON.parse(fs_1.default.readFileSync(QUOTED_FILE, "utf-8"));
            }
            // Search latest tweets from big accounts with scam keywords
            const scamKeywords = [
                `"congrats"`,
                `"you've been selected"`,
                `"grab your chance"`,
                `"see more"`,
                `"airdrop"`,
                `"claim reward"`,
                `"free mint"`,
                `"100% safe"`,
                `"guaranteed"`,
                `"limited offer"`,
                `"investment opportunity"`,
                `"send eth"`,
                `"double your"`,
                `"click here"`,
                `"exclusive deal"`,
                `"urgent"`,
                `"act now"`,
                `"drop your address"`,
            ];
            const queries = scamKeywords.join(" OR ");
            const feed = (yield scraper.fetchSearchTweets(queries, 5, agent_twitter_client_1.SearchMode.Top))
                .tweets;
            console.log(`Fetched ${feed.length} tweets for scam analysis.`);
            const newQuoted = [];
            for (const tweet of feed) {
                if (looksLikeScam(tweet) &&
                    (yield isBigAccount(tweet)) &&
                    !quoted.includes(tweet.id)) {
                    const commentary = yield writeInVoice(tweet.text, true);
                    const qid = yield quoteTweet(commentary, tweet.id);
                    if (qid) {
                        console.log(`⚡ Quoted scam tweet ${tweet.id}`);
                        newQuoted.push({ id: tweet.id });
                    }
                }
            }
            // Save updated quoted list
            fs_1.default.writeFileSync(QUOTED_FILE, JSON.stringify([...feed, ...newQuoted], null, 2));
        }
        catch (e) {
            console.error("Scam watcher error:", e);
        }
    });
}
// =========================================
// API
// =========================================
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.get("/health", (req, res) => res.json({ ok: true, agent: main_json_1.default.name, time: new Date().toISOString() }));
app.post("/draft", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { prompt, is_reply } = req.body;
    const text = yield writeInVoice(prompt, is_reply);
    res.json({ draft: text });
}));
app.post("/tweet", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { prompt, is_reply, reply_to_id } = req.body;
    const text = yield writeInVoice(prompt, is_reply);
    let tid;
    if (is_reply && reply_to_id) {
        tid = yield replyToTweet(text, reply_to_id);
    }
    else {
        tid = yield postTweet(text);
    }
    res.json({ posted_id: tid, text });
}));
// =========================================
// Start
// =========================================
// /* async function startScheduler() {
//   await loadKB();
//   schedule.scheduleJob("20 22 * * *", scheduledOriginalPosts);
//   schedule.scheduleJob("0 14 * * *", scheduledOriginalPosts);
//   schedule.scheduleJob("0 20 * * *", scheduledOriginalPosts);
//   schedule.scheduleJob("*/15 * * * *", scheduledMentionsReply);
//   schedule.scheduleJob("* */4 * * *", scheduledScamWatcher);
// }
//  */
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
        yield loadKB();
        bot.start((ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield loadKB();
            const result = yield genAI.models.generateContent({
                model: aiModel,
                contents: "Welcome the user and ask what they want to tweet about today",
                config: {
                    thinkingConfig: {
                        thinkingBudget: 0, // Disables thinking
                    },
                    systemInstruction: "You are an AI Agent that speaks in a voice of ancient scripture: solemn, witty and wise.",
                },
            });
            ctx.reply((_a = result.text) !== null && _a !== void 0 ? _a : "Hello");
        }));
        bot.command("quit", (ctx) => __awaiter(this, void 0, void 0, function* () {
            // Explicit usage
            yield ctx.telegram.leaveChat(ctx.message.chat.id);
            // Using context shortcut
            yield ctx.leaveChat();
        }));
        bot.on((0, filters_1.message)("text"), (ctx) => __awaiter(this, void 0, void 0, function* () {
            console.log("here");
            if (ctx.message.text.startsWith("/tweet ")) {
                const message = ctx.message.text;
                console.log(message);
                const prompt = message.split("/tweet ")[1];
                console.log(prompt);
                const text = yield writeInVoice(prompt, false);
                yield ctx.reply(text);
            }
            if (ctx.message.text.startsWith("/reply ")) {
                const message = ctx.message.text;
                console.log(message);
                const prompt = message.split("/reply ")[1];
                console.log(prompt);
                const text = yield writeInVoice(prompt, true);
                yield ctx.reply(text);
            }
        }));
        bot.on("callback_query", (ctx) => __awaiter(this, void 0, void 0, function* () {
            // Explicit usage
            yield ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
            // Using context shortcut
            yield ctx.answerCbQuery();
        }));
        bot.launch();
        // Enable graceful stop
        process.once("SIGINT", () => bot.stop("SIGINT"));
        process.once("SIGTERM", () => bot.stop("SIGTERM"));
    });
}
startServer()
    .catch((e) => console.error("Startup error:", e));
