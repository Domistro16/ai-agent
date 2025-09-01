import { Scraper, SearchMode } from 'agent-twitter-client';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { askGemini } from './ask';
import dotenv from "dotenv";
import fs from "fs"
import { log } from 'console';
import { stringify } from 'querystring';

dotenv.config();

const number = Number(process.env.REPLY_LATEST_TWEET) || 5;

function removeFirstWord(str: string): string {
    const words = str.split(" ");
    return words.slice(1).join(" ");
}

export const replyTweet = async function handle(genAI: GoogleGenerativeAI, scraper: Scraper, username: string) {
    const replyTweets = (
        await scraper.fetchSearchTweets(
            `@${username}`,
            number,
            SearchMode.Latest
        )
    ).tweets;

    // Load memory of already replied tweets
    const file = "replied.json";
    let replied: any[] = [];
    if (fs.existsSync(file)) {
        replied = JSON.parse(fs.readFileSync(file, "utf-8"));
    }

    // Filter tweets we haven't replied to yet
    const toReply = replyTweets.filter(
        (tweet: any) => !replied.some((item: any) => item.id === tweet.id)
    );

    let newReplies: any[] = [];

    for (const tweet of toReply) {
        const replyID = tweet.id;
        const replyContent = removeFirstWord(tweet.text!);

        // Grab original tweet in the conversation
        const target = await scraper.getTweet(tweet.conversationId!);
        const targetText = target?.text;

        // Ask Gemini what to reply
        const contentToReply = await askGemini(genAI, "reply", targetText, replyContent);

        try {
            await scraper.sendTweet(contentToReply, replyID);
            console.log(`✅ Replied to tweet ${replyID}: ${contentToReply}`);

            newReplies.push({ id: replyID }); // store only the id
        } catch (error) {
            console.log("❌ Error when replying:", error);
        }
    }

    // Save memory of all replied tweets (old + new)
    fs.writeFileSync(file, JSON.stringify([...replied, ...newReplies], null, 2));
    
}