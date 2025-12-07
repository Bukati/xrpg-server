import { PrismaClient } from './node_modules/.prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting all quests and related data...');
  
  const deleted = await prisma.$transaction([
    prisma.chapterVote.deleteMany(),
    prisma.questVote.deleteMany(),
    prisma.execution.deleteMany(),
    prisma.chapter.deleteMany(),
    prisma.quest.deleteMany(),
  ]);
  
  console.log('✅ All quests cleaned!');
  console.log('Deleted:', deleted);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
