import 'dotenv/config';

const [{ default: app }, { logger }, { prisma }, { initializeJobs }] = await Promise.all([
  import('./app.js'),
  import('./lib/logger.js'),
  import('./lib/prisma.js'),
  import('./jobs/index.js')
]);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await prisma.user.count();
    logger.info('Database connection verified');
  } catch (error) {
    logger.error('Database startup check failed', {
      message: error.message,
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL)
    });
    process.exit(1);
  }

  await initializeJobs();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    logger.info(`Server started on port ${PORT}`);
  });
};

startServer();
