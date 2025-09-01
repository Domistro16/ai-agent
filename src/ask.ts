import { GoogleGenerativeAI } from "@google/generative-ai";
import agentData from "../character/main.json";
import hodlData from "../character/knowledge/chronicles_library.json";
import altData from "../character/knowledge/extra_knowledge.json";
import dotenv from "dotenv";

dotenv.config();

const tweetChar = process.env.TWEET_CHAR_LIMIT || 200;
const aiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function getRandomVerse() {
  const random = Math.random() * 7;
  const section = hodlData.library[random].section;
  const chapters = hodlData.library[random].chapters;
  const chapter = chapters[Math.floor(Math.random() * chapters.length)];
  const verse =
    chapter.verses[Math.floor(Math.random() * chapter.verses.length)];
  return `"${verse.text}" — ${section} HODL Scriptures ${chapter.chapter}:${verse.verse}`;
}

function getAltContext(question: string) {
  // for now, just grab random alt knowledge (later you can embed+search)
  const doc = altData[Math.floor(Math.random() * altData.length)];
  return doc.text;
}

export async function askGemini(
  genAi: GoogleGenerativeAI,
  mission: string,
  targetText?: any,
  replyContent?: any
): Promise<string> {
  const model = genAi.getGenerativeModel({ model: aiModel });

  try {
    let grounding = "";
    const roll = Math.random();

    if (roll <= 0.8) {
      // 80% Chronicles of HODL
      grounding = getRandomVerse();
      console.log("Using HODL scripture as context.");
    } else {
      // 20% Alt KB → pass into system prompt as context
      grounding = getAltContext(targetText || replyContent || "general");
    }

    let sub = "";
    if (mission === "tweet") {
      console.log("Tweeting...");
      sub = `
      You are ${
        agentData.name
      }, an AI scribe for “The Chronicles of the HODL Scriptures.”.
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
    } else if (mission === "reply") {
      console.log("Replying...");
      sub = `
      You are ${agentData.name}, an AI scribe for “The Chronicles of the HODL Scriptures.”.
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

    const result = await model.generateContent(sub);
    return result.response.text();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "";
  }
}
