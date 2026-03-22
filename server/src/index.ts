import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: true
});

fastify.get('/ping', async (request, reply) => {
  return { status: 'ok', time: new Date().toISOString() };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
