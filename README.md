```
                    ██████╗ ██████╗  ██████╗
                    ██╔══██╗██╔══██╗██╔════╝
█████╗█████╗█████╗  ██████╔╝██████╔╝██║  ███╗
╚════╝╚════╝╚════╝  ██╔══██╗██╔═══╝ ██║   ██║
                    ██║  ██║██║     ╚██████╔╝
                    ╚═╝  ╚═╝╚═╝      ╚═════╝
        ⚔️  Critical thinking as a blood sport  ⚔️
```

<div align="center">

[![Website](https://img.shields.io/badge/Website-xrpg.gg-8B5CF6?style=for-the-badge)](https://xrpg.gg)
[![X](https://img.shields.io/badge/Bot-@xRPGBot-000000?style=for-the-badge&logo=x)](https://x.com/xRPGBot)
[![Creator](https://img.shields.io/badge/Creator-@bukati-1DA1F2?style=for-the-badge&logo=x)](https://x.com/bukati)

**Backend API for xRPG - The Grok-powered "what-if" simulation game on X**

[Website](https://xrpg.gg) · [Play on X](https://x.com/xRPGBot) · [Frontend Repo](https://github.com/user/xrpg-client)

</div>

---

## ⚡ What is xRPG?

xRPG turns any spicy tweet into a branching "what-if" simulation powered by Grok AI and real historical context. Pick an ideology, watch history show you the receipts.

**The game doesn't lecture. It shows consequences.**

## 🏗️ Tech Stack

- **Framework:** NestJS (Node.js)
- **Database:** PostgreSQL + Prisma ORM
- **Queue:** BullMQ + Redis
- **AI:** Grok API (x.ai) + Parallel AI (search)
- **Auth:** X OAuth 2.0 with PKCE

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis

### Installation

```bash
# Clone the repo
git clone https://github.com/user/xrpg-server.git
cd xrpg-server

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

### Environment Variables

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://localhost:6379"
GROK_API_KEY="your_grok_api_key"
PARALLEL_API_KEY="your_parallel_api_key"
X_API_CONSUMER_KEY="your_x_consumer_key"
X_API_CONSUMER_SECRET="your_x_consumer_secret"
TWITTER_CLIENT_ID="your_oauth2_client_id"
TWITTER_CLIENT_SECRET="your_oauth2_client_secret"
```

## 📁 Project Structure

```
src/
├── auth/           # X OAuth 2.0 authentication
├── database/       # Prisma service & schema
├── game/           # Core game logic & quest management
├── grok/           # Grok AI integration
├── queues/         # BullMQ workers for chapter progression
├── redis/          # Redis caching service
└── tweets/         # X API integration
```

## 🎮 How It Works

1. User tags `@xRPGBot` on a spicy tweet
2. Grok evaluates if it's "game-worthy"
3. Generates a 5-chapter branching scenario
4. Community votes on choices (reply with 1 or 2)
5. Each chapter shows real historical consequences

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ⚔️ by [@bukati](https://x.com/bukati)**

*History doesn't repeat — it rhymes, and Grok is the DJ.*

</div>
