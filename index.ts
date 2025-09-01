import dotenv from "dotenv";

// Scraper
import { Scraper, SearchMode, Tweet } from "agent-twitter-client";

// Gemini
import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

// Functions
import express, { Request, Response } from "express";
import fs from "fs";
import agentData from "./character/main.json";
import Bottleneck from "bottleneck";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";
const aiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const scraper = new Scraper();
const genAI = new GoogleGenAI({ apiKey });

interface State {
  since_id: number | null;
}

interface Scripture {
  section: string;
  chapter: number;
  chapterTitle: string;
  verse: number;
  text: string;
  embedding: number[];
}

interface DraftRequest {
  prompt: string;
  is_reply?: boolean;
}

interface TweetRequest extends DraftRequest {
  reply_to_id?: string | null;
}

// =========================================
// State persistence
// =========================================
const STATE_PATH = "./state.json";


// =========================================
// Embedding Helpers
// =========================================
async function embedBatch(texts: string[]): Promise<number[][]> {
  const result = await genAI.models.embedContent({
    model: "gemini-embedding-001", // official embedding model
    contents: texts,
    config: {
      taskType: "SEMANTIC_SIMILARITY",
    },
  });
  if (result.embeddings) {
    return result.embeddings?.map((e) => e.values!);
  } else {
    return [];
  }
}

// Allow 100 embeddings per minute
const limiter = new Bottleneck({
  reservoir: 100, // number of tokens available
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000, // refresh every minute
  minTime: 600, // at least 1 call every 600ms
});

async function embedText(text: string): Promise<number[]> {
  return limiter.schedule(async () => {
    const result = await genAI.models.embedContent({
      model: "gemini-embedding-001",
      contents: [text],
      config: { taskType: "SEMANTIC_SIMILARITY" },
    });

    if (result.embeddings) {
      return result.embeddings[0].values!;
    }
    return [];
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
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

let kb: Scripture[] = [];

async function loadKB() {
  if (fs.existsSync(KB_EMBED_PATH)) {
    // ✅ Load pre-computed embeddings
    kb = JSON.parse(fs.readFileSync(KB_EMBED_PATH, "utf8")) as Scripture[];
    console.log(`📦 Loaded ${kb.length} scripture verses (with embeddings).`);
    return;
  }

  if (fs.existsSync(KB_PATH)) {
    const raw = JSON.parse(fs.readFileSync(KB_PATH, "utf8")) as any;
    if (raw.library && Array.isArray(raw.library)) {
      for (const book of raw.library) {
        const sectionName = book.section;
        console.log(sectionName);
        for (const chapter of book.chapters || []) {
          const chapterNum = chapter.chapter;
          const chapterTitle = chapter.title;
          for (const verse of chapter.verses || []) {
            const text = verse.text;
            const embedding = await embedText(text);
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
      fs.writeFileSync(KB_EMBED_PATH, JSON.stringify(kb, null, 2));
      console.log(`💾 Saved ${kb.length} verses with embeddings.`);
    }
  } else {
    console.warn("⚠️ No chronicles_library.json found, knowledge base empty.");
  }
}

// retrieval
function querySimilarity(q: string, doc: string): number {
  const qWords = new Set(q.toLowerCase().split(/\W+/));
  const dWords = new Set(doc.toLowerCase().split(/\W+/));
  let overlap = 0;
  qWords.forEach((w) => {
    if (dWords.has(w)) overlap++;
  });
  return overlap;
}

async function retrieve(query: string, k: number): Promise<string[]> {
  if (!kb.length) return [];
  const queryEmbedding = await embedText(query);

  return kb
    .map((d) => ({
      reference: `Book ${d.section}, Chapter ${d.chapter} (${d.chapterTitle}), Verse ${d.verse}`,
      text: d.text,
      score: d.embedding ? cosineSimilarity(queryEmbedding, d.embedding) : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((d) => `${d.text}\n— ${d.reference}`);
}

// =========================================
// Style + Filters
// =========================================
function stripHashtagsEmojis(text: string): string {
  return text
    .replace(/#\w+/g, "")
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+/gu,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function hardLengthLimit(text: string, limit = 280): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

function finalStylePass(text: string): string {
  let out = stripHashtagsEmojis(text);
  out = out.replace(
    /\b(click|subscribe|follow|retweet|like|share)\b/gi,
    "consider"
  );
  return hardLengthLimit(out);
}

async function isBigAccount(tweet: Tweet): Promise<boolean> {
  const user = await scraper.getProfile(tweet.username!);
  return (user.followersCount ?? 0) > 5000; // threshold, adjust as needed
}

function looksLikeScam(tweet: Tweet): boolean {
  if (!tweet?.text) return false;
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

  if (scamKeywords.some((kw) => new RegExp(kw, "i").test(text))) score += 2; // strong signal

  // 2️⃣ Suspicious URLs
  const urlPatterns = [
    /\.cn\//,
    /\.ru\//,
    /bit\.ly/,
    /tinyurl/,
    /rebrand\.ly/,
    /free-[a-z0-9]+/,
  ];
  if (
    tweet.urls?.some((url: any) =>
      urlPatterns.some((p) => p.test(url.expanded_url))
    )
  )
    score += 3; // very strong signal

  // 3️⃣ Excessive mentions or hashtags
  if ((tweet.mentions?.length ?? 0) > 5) score += 1;
  if ((tweet.hashtags?.length ?? 0) > 5) score += 1;

  // 4️⃣ Shouting / all caps
  const plainText = text.replace(/\W/g, "");
  if (plainText.length > 20 && plainText === plainText.toUpperCase())
    score += 1;

  // 5️⃣ Crypto addresses
  if (/\b(0x[a-f0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/.test(text))
    score += 3;

  // 6️⃣ Optional: suspicious punctuation patterns (!!!, $$$, ***, etc.)
  if (/[!$*]{3,}/.test(text)) score += 1;

  console.log(`Tweet ID ${tweet.id} scam score: ${score}`);

  // Threshold: adjust as needed
  return score >= 5; // need combined strong signals
}

// =========================================
// Prompting
// =========================================
const SYSTEM_PROMPT = `
You are ${agentData.name}, an AI scribe for “The Chronicles of the HODL Scriptures.”
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

async function writeInVoice(
  topicOrReply: string,
  isReply = false
): Promise<string> {
  const docs = await retrieve(topicOrReply, 1);

  let scriptureRef = "";
  if (docs.length > 0) {
    const [text, reference] = docs[0].split("\n— ");
    scriptureRef = reference ? `\n— ${reference}` : "";
  }

  const ctx: string = docs.length
    ? `Context from HODL scriptures:\n${docs.join("\n\n")}`
    : "";

  const userPrompt: string = isReply
    ? `Compose a brief reply in-voice to this tweet:\n${topicOrReply}`
    : `Compose an original tweet in-voice about:\n${topicOrReply}`;

  const prompt: string = `${ctx}\n\n${userPrompt}`;
  let messages = [];

  for (const shots of FEW_SHOTS) {
    const message = {
      role: shots[0],
      message: shots[1],
    };
    messages.push(message);
  }

  const result = await genAI.models.generateContent({
    model: aiModel,
    contents: prompt,
    config: {
      thinkingConfig: {
        thinkingBudget: 0, // Disables thinking
      },
      systemInstruction: SYSTEM_PROMPT,
    },
  });
  let text: string = result.text!;

  text = finalStylePass(`${text}`);
  return text;
}

// =========================================
// Twitter Actions
// =========================================
async function postTweet(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  console.log("Posting tweet:", text);
  try {
    const tweet = await scraper.sendTweet(text);
    const res = await tweet.json();
    return res.id ?? null;
  } catch (e) {
    console.error("Tweet error:", e);
    return null;
  }
}

async function replyToTweet(
  text: string,
  replyId: string
): Promise<string | null> {
  console.log("Posting tweet:", text);
  try {
    const tweet = await scraper.sendTweet(text, replyId);
    const res = await tweet.json();
    return res.id ?? null;
  } catch (e) {
    console.error("Reply error:", e);
    return null;
  }
}

async function quoteTweet(
  text: string,
  quoteId: string
): Promise<string | null> {
  try {
    const tweet = await scraper.sendQuoteTweet(text, quoteId);
    const res = await tweet.json();
    return res.id ?? null;
  } catch (e) {
    console.error("Quote Tweet error:", e);
    return null;
  }
}

// =========================================
// Scheduler tasks
// =========================================
async function scheduledOriginalPosts(): Promise<void> {
  const topics = [
    "endurance through volatile seasons",
    "wisdom of building slowly",
    "the snares of greed and the frost of fear",
    "patience in cycles and DCA",
    "community, humility, and long memory of chains",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const text = await writeInVoice(topic, false);
  await postTweet(text);
}

async function scheduledMentionsReply(): Promise<void> {
  try {
    const url = `https://api.x.com/2/users/${process.env.ID}/mentions?max_results=5`;
    const options = {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.BEARER}` },
      body: undefined,
    };

    let mentions: any[] = [];
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      console.log(data);
      mentions = data.data;
    } catch (error) {
      console.error(error);
    }

    console.log(mentions);

    const file = "replied.json";
    let replied: any[] = [];
    if (fs.existsSync(file)) {
      replied = JSON.parse(fs.readFileSync(file, "utf-8"));
    }
    const toReply = mentions.filter(
      (tweet: any) => !replied.some((item: any) => item.id === tweet.id)
    );

    let newReplies: any[] = [];

    for (const m of toReply) {
      if (m.text?.trim() === "@Domistro19" && m.isReply === true) {
        const tweet = await scraper.getTweet(m.id!);
        const topTweet = await scraper.getTweet(tweet?.inReplyToStatusId!);
        const replyText = await writeInVoice(topTweet?.text!, true);
        await quoteTweet(replyText, topTweet?.id!);
      } else {
        const replyText = await writeInVoice(m.text!, true);
        await replyToTweet(replyText, m.id!);
        newReplies.push({ id: m.id });
      }
    }

    fs.writeFileSync(
      file,
      JSON.stringify([...mentions, ...newReplies], null, 2)
    );
  } catch (e) {
    console.error("Mentions error:", e);
  }
}

const QUOTED_FILE = "./quoted.json";

async function scheduledScamWatcher(): Promise<void> {
  try {
    // Load already quoted tweets
    let quoted: string[] = [];
    if (fs.existsSync(QUOTED_FILE)) {
      quoted = JSON.parse(fs.readFileSync(QUOTED_FILE, "utf-8"));
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

    const feed = (await scraper.fetchSearchTweets(queries, 5, SearchMode.Top))
      .tweets;

    console.log(`Fetched ${feed.length} tweets for scam analysis.`);

    const newQuoted = [];

    for (const tweet of feed) {
      if (
        looksLikeScam(tweet) &&
        (await isBigAccount(tweet)) &&
        !quoted.includes(tweet.id!)
      ) {
        const commentary = await writeInVoice(tweet.text!, true);
        const qid = await quoteTweet(commentary, tweet.id!);
        if (qid) {
          console.log(`⚡ Quoted scam tweet ${tweet.id}`);
          newQuoted.push({ id: tweet.id! });
        }
      }
    }

    // Save updated quoted list
    fs.writeFileSync(
      QUOTED_FILE,
      JSON.stringify([...feed, ...newQuoted], null, 2)
    );
  } catch (e) {
    console.error("Scam watcher error:", e);
  }
}

// =========================================
// API
// =========================================
const app = express();
app.use(express.json());

app.get("/health", (req: Request, res: Response) =>
  res.json({ ok: true, agent: agentData.name, time: new Date().toISOString() })
);

app.post(
  "/draft",
  async (req: Request<{}, {}, DraftRequest>, res: Response) => {
    const { prompt, is_reply } = req.body;
    const text = await writeInVoice(prompt, is_reply);
    res.json({ draft: text });
  }
);

app.post(
  "/tweet",
  async (req: Request<{}, {}, TweetRequest>, res: Response) => {
    const { prompt, is_reply, reply_to_id } = req.body;
    const text = await writeInVoice(prompt, is_reply);
    let tid: string | null;
    if (is_reply && reply_to_id) {
      tid = await replyToTweet(text, reply_to_id);
    } else {
      tid = await postTweet(text);
    }
    res.json({ posted_id: tid, text });
  }
);

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
const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start(async (ctx) => {
  await loadKB();
  const result = await genAI.models.generateContent({
    model: aiModel,
    contents: "Welcome the user and ask what they want to tweet about today",
    config: {
      thinkingConfig: {
        thinkingBudget: 0, // Disables thinking
      },
      systemInstruction:
        "You are an AI Agent that speaks in a voice of ancient scripture: solemn, witty and wise.",
    },
  });
  ctx.reply(result.text ?? "Hello");
});

bot.command("quit", async (ctx) => {
  // Explicit usage
  await ctx.telegram.leaveChat(ctx.message.chat.id);

  // Using context shortcut
  await ctx.leaveChat();
});

bot.on(message("text"), async (ctx) => {
  console.log("here");
  if (ctx.message.text.startsWith("/tweet ")) {
    const message = ctx.message.text;
    console.log(message);
    const prompt = message.split("/tweet ")[1];
    console.log(prompt);
    const text = await writeInVoice(prompt, false);
    await ctx.reply(text);
  }
  if (ctx.message.text.startsWith("/reply ")) {
    const message = ctx.message.text;
    console.log(message);
    const prompt = message.split("/reply ")[1];
    console.log(prompt);
    const text = await writeInVoice(prompt, true);
    await ctx.reply(text);
  }
});

bot.on("callback_query", async (ctx) => {
  // Explicit usage
  await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

  // Using context shortcut
  await ctx.answerCbQuery();
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
