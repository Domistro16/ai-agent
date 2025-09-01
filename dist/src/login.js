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
exports.login = login;
const fs_1 = __importDefault(require("fs"));
function cacheCookies(cookies) {
    return __awaiter(this, void 0, void 0, function* () {
        fs_1.default.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    });
}
function getCachedCookies() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync('cookies.json')) {
            const cookiesData = fs_1.default.readFileSync('cookies.json', 'utf-8');
            return JSON.parse(cookiesData);
        }
        return null;
    });
}
function clearCachedCookies() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync('cookies.json')) {
            fs_1.default.unlinkSync('cookies.json');
            console.log("Old cookies deleted.");
        }
    });
}
function login(scraper, username, password, email, fa) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const cachedCookies = yield getCachedCookies();
            if (cachedCookies) {
                console.log("Using cached cookies...");
                const cookieStrings = cachedCookies.map((cookie) => `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${cookie.secure ? "Secure" : ""}; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${cookie.sameSite || "Lax"}`);
                yield scraper.setCookies(cookieStrings);
                const isLoggedIn = yield scraper.isLoggedIn();
                if (!isLoggedIn) {
                    console.log("Cookies expired or invalid. Logging in again...");
                    yield clearCachedCookies();
                    yield scraper.login(username, password, email, fa);
                    const cookies = yield scraper.getCookies();
                    yield cacheCookies(cookies);
                }
            }
            else {
                console.log("No cached cookies, logging in...");
                yield scraper.login(username, password, email, fa);
                const cookies = yield scraper.getCookies();
                yield cacheCookies(cookies);
            }
        }
        catch (error) {
            console.error("Error login:", error);
        }
        return true;
    });
}
