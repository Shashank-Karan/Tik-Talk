# tik talk

real-time anonymous chat for any website. chat with anyone browsing the same page as you.

### why?
sometimes you're on a website (like a product page or a news article) and you want to talk to other people who are there right now. tik talk lets you do that instantly. no login, no tracking, just chat.

### features
- works everywhere (any url is a room)
- real-time (no delay)
- anonymous (no accounts)
- super light (text-only for speed)

### quick start

**1. setup the server**
```bash
cd server
npm install
npm start
```
(if you're deploying, i recommend using [render.com](https://render.com) - it's free and easy)

**2. update the url**
in `extension/popup.js`, change the `SERVER_URL` to your live server link.

**3. load the extension**
- open `chrome://extensions` (or `edge://extensions`)
- turn on **developer mode**
- click **load unpacked** and pick the `extension` folder

### contributing
if you want to add stuff, check out [contributing.md](CONTRIBUTING.md). we love stickers, dark mode, and speed fixes.

### license
mit - do whatever you want with the code.
