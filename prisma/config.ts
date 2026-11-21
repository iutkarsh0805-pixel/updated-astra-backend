import { PrismaNeon } from '@prisma/adapter-neon';

export default {
  schema: './schema.prisma',
  datasource: {
    db: {
      url: process.env.DATABASE_URL,
      adapter: new PrismaNeon(),
    },
  },
};
