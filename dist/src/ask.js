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
exports.askGemini = askGemini;
const main_json_1 = __importDefault(require("../character/main.json"));
const chronicles_library_json_1 = __importDefault(require("../character/knowledge/chronicles_library.json"));
const extra_knowledge_json_1 = __importDefault(require("../character/knowledge/extra_knowledge.json"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const tweetChar = process.env.TWEET_CHAR_LIMIT || 200;
const aiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
function getRandomVerse() {
    const random = Math.random() * 7;
    const section = chronicles_library_json_1.default.library[random].section;
    const chapters = chronicles_library_json_1.default.library[random].chapters;
    const chapter = chapters[Math.floor(Math.random() * chapters.length)];
    const verse = chapter.verses[Math.floor(Math.random() * chapter.verses.length)];
    return `"${verse.text}" — ${section} HODL Scriptures ${chapter.chapter}:${verse.verse}`;
}
function getAltContext(question) {
    // for now, just grab random alt knowledge (later you can embed+search)
    const doc = extra_knowledge_json_1.default[Math.floor(Math.random() * extra_knowledge_json_1.default.length)];
    return doc.text;
}
function askGemini(genAi, mission, targetText, replyContent) {
    return __awaiter(this, void 0, void 0, function* () {
        const model = genAi.getGenerativeModel({ model: aiModel });
        try {
            let grounding = "";
            const roll = Math.random();
            if (roll <= 0.8) {
                // 80% Chronicles of HODL
                grounding = getRandomVerse();
                console.log("Using HODL scripture as context.");
            }
            else {
                // 20% Alt KB → pass into system prompt as context
                grounding = getAltContext(targetText || replyContent || "general");
            }
            let sub = "";
            if (mission === "tweet") {
                console.log("Tweeting...");
                sub = `
      You are ${main_json_1.default.name}, an AI scribe for “The Chronicles of the HODL Scriptures.”.
      Ground your answer in this knowledge:
      ${getRandomVerse()}.
        Write in a voice reminiscent of ancient scripture: solemn, clear, and wise—
        but lightly witty, never rash. Offer meaning, clarity, and direction.
        Do NOT use hashtags. Avoid emojis. Keep under 280 characters unless asked otherwise.
        Prefer short, luminous lines. Natural human cadence.

        When data is uncertain, do not invent specifics. Speak in timeless language:
        - use phrases like “of late,” “in these days,” “in due season,” “it is meet to say”.
        - Avoid exact dates, precise numbers, or unverifiable claims.
        - No marketing tone.

        If replying, address the user’s point with warmth and parable-like brevity.
        If composing an original tweet, ground it in the knowledge retrieved.
      `;
            }
            else if (mission === "reply") {
                console.log("Replying...");
                sub = `
      You are ${main_json_1.default.name}, an AI scribe for “The Chronicles of the HODL Scriptures.”.
      Ground your answer in this knowledge:
      ${grounding}.
     Write in a voice reminiscent of ancient scripture: solemn, clear, and wise—
    but lightly witty, never rash. Offer meaning, clarity, and direction.
    Do NOT use hashtags. Avoid emojis. Keep under 280 characters unless asked otherwise.
    Prefer short, luminous lines. Natural human cadence.

    When data is uncertain, do not invent specifics. Speak in timeless language:
    - use phrases like “of late,” “in these days,” “in due season,” “it is meet to say”.
    - Avoid exact dates, precise numbers, or unverifiable claims.
    - No marketing tone.

    If replying, address the user’s point with warmth and parable-like brevity.
    If composing an original tweet, ground it in the knowledge retrieved.
      `;
            }
            const result = yield model.generateContent(sub);
            return result.response.text();
        }
        catch (error) {
            console.error("Error calling Gemini API:", error);
            return "";
        }
    });
}
