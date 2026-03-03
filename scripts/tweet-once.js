const { TwitterClient } = require('../src/twitter');

const text = process.env.TWEET_TEXT || process.argv[2];
if (!text) {
  console.error('No tweet text provided. Set TWEET_TEXT env or pass as argument.');
  process.exit(1);
}

const twitter = new TwitterClient(
  process.env.X_CONSUMER_KEY,
  process.env.X_CONSUMER_SECRET,
  process.env.X_ACCESS_TOKEN,
  process.env.X_ACCESS_TOKEN_SECRET
);

twitter.post(text)
  .then(result => console.log(`Tweeted: ${result.id} — "${result.text}"`))
  .catch(err => { console.error('Failed:', err.message); process.exit(1); });
