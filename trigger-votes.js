const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const prisma = new PrismaClient();

async function triggerVoteCollection() {
  const queue = new Queue('chapter-progression', {
    connection: {
      host: process.env.REDIS_URL.includes('upstash') ? new URL(process.env.REDIS_URL).hostname : 'localhost',
      port: parseInt(new URL(process.env.REDIS_URL).port) || 6379,
      username: new URL(process.env.REDIS_URL).username || undefined,
      password: new URL(process.env.REDIS_URL).password || undefined,
      tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    },
  });

  const activeQuests = await prisma.quest.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, shortId: true, currentChapter: true },
  });

  console.log(`Found ${activeQuests.length} active quests`);

  for (const quest of activeQuests) {
    console.log(`Triggering vote collection for quest ${quest.shortId} (chapter ${quest.currentChapter})`);
    await queue.add('collect-votes', {
      questId: quest.id,
      chapterNumber: quest.currentChapter,
    });
  }

  await queue.close();
  await prisma.$disconnect();
  console.log('Done!');
}

triggerVoteCollection();
