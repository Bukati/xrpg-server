// IMPORTANT: Load environment variables BEFORE any other imports
// This ensures env vars are available during module decoration time
import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS with credentials
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // Enable cookie parser
  app.use(cookieParser());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log('');
  console.log('🚀 Server is running!');
  console.log(`📍 Local:   http://localhost:${port}`);
  console.log(`📍 Network: http://0.0.0.0:${port}`);
  console.log('');
}
bootstrap();
