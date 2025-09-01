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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlTweets = crawlTweets;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const amount = Number(process.env.TWEET_CRAWL) || 10;
function crawlTweets(scraper, listUsers) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        if (listUsers.length === 0) {
            console.error("No users to crawl");
            return;
        }
        for (const user of listUsers) {
            console.log("Crawling tweets for user:", user);
            const tweets = scraper.getTweets(user, amount);
            try {
                for (var _d = true, tweets_1 = (e_1 = void 0, __asyncValues(tweets)), tweets_1_1; tweets_1_1 = yield tweets_1.next(), _a = tweets_1_1.done, !_a; _d = true) {
                    _c = tweets_1_1.value;
                    _d = false;
                    const tweet = _c;
                    console.log("Tweet:", tweet.text);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_d && !_a && (_b = tweets_1.return)) yield _b.call(tweets_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
    });
}
