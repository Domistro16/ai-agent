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
exports.replyTweet = void 0;
const agent_twitter_client_1 = require("agent-twitter-client");
const ask_1 = require("./ask");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
const number = Number(process.env.REPLY_LATEST_TWEET) || 5;
function removeFirstWord(str) {
    const words = str.split(" ");
    return words.slice(1).join(" ");
}
const replyTweet = function handle(genAI, scraper, username) {
    return __awaiter(this, void 0, void 0, function* () {
        const replyTweets = (yield scraper.fetchSearchTweets(`@${username}`, number, agent_twitter_client_1.SearchMode.Latest)).tweets;
        // Load memory of already replied tweets
        const file = "replied.json";
        let replied = [];
        if (fs_1.default.existsSync(file)) {
            replied = JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
        }
        // Filter tweets we haven't replied to yet
        const toReply = replyTweets.filter((tweet) => !replied.some((item) => item.id === tweet.id));
        let newReplies = [];
        for (const tweet of toReply) {
            const replyID = tweet.id;
            const replyContent = removeFirstWord(tweet.text);
            // Grab original tweet in the conversation
            const target = yield scraper.getTweet(tweet.conversationId);
            const targetText = target === null || target === void 0 ? void 0 : target.text;
            // Ask Gemini what to reply
            const contentToReply = yield (0, ask_1.askGemini)(genAI, "reply", targetText, replyContent);
            try {
                yield scraper.sendTweet(contentToReply, replyID);
                console.log(`✅ Replied to tweet ${replyID}: ${contentToReply}`);
                newReplies.push({ id: replyID }); // store only the id
            }
            catch (error) {
                console.log("❌ Error when replying:", error);
            }
        }
        // Save memory of all replied tweets (old + new)
        fs_1.default.writeFileSync(file, JSON.stringify([...replied, ...newReplies], null, 2));
    });
};
exports.replyTweet = replyTweet;
