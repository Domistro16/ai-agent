# AI-Agent: Twitter Automation with Gemini Model

AI-Agent is a powerful automation tool designed to interact with Twitter, providing functionalities to crawl tweets, automatically post content, and reply to comments. This agent is powered by the Gemini Model to generate human-like content.

## 🚀 Features
- **Crawl Tweets**: Collect recent tweets from specific users.  
- **Auto-Tweet**: Generate and post tweets using the Gemini Model.  
- **Auto-Reply**: Automatically reply to comments with context-aware responses.  

## 🛠️ Installation
1. **Install Dependencies**  
   ```bash
   npm install
   ```
2. **Set Up Environment Variables**  
   - Copy the example environment file:
     ```bash
     cp .env.example .env
     ```
   - Fill in your environment variables in `.env`.

3. **Configure Agent Profile**  
   - Provide character details in `character/main.json`:
     ```json
     {
       "agent": "YourAgentName",
       "bio": ["Short description of your agent"],
       "knowledge": ["Key facts or context your agent should know"]
     }
     ```

## 📘 Usage
### 1️⃣ Crawl Tweets
To crawl tweets from a specific user:
```bash
npm start crawl [username]
```
Example:
```bash
npm start crawl elonmusk
```

### 2️⃣ Post a Tweet
Generate and post a tweet using the Gemini Model:
```bash
npm start tweet
```

### 3️⃣ Reply to Comments
Automatically reply to the latest comments:
```bash
npm start reply
```

## 💡 Notes
- Ensure your `.env` file contains valid credentials (e.g., Twitter API keys and Gemini API key).  
- The `character/main.json` file helps the agent generate personalized responses.  
- The agent uses `Gemini Model` for tweet generation and replies.

## 📝 Example `.env` Structure
```env
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email
TWITTER_2FA_SECRET=your_2fa_secret
TWEET_CRAWL=10                        # Number of tweets to crawl (default: 10, max: 800)
TWEET_CHAR_LIMIT=280                  # Tweet character limit (requires Premium+ X Account)
REPLY_LATEST_TWEET=5                  # Number of latest tweets to reply to (default: 5)
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-1.5-flash         # Default model
```

## 📚 Contributing
Feel free to contribute to improve this project. Fork the repository and create a pull request with your changes.

## ⚖️ License
This project is licensed under the MIT License.

---
Happy tweeting with AI-Agent! 🤖🐦

