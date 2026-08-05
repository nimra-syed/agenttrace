import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTaggedTestData } from './support/cleanup';
import { createTestApp } from './support/test-app';
import {
  body,
  signupAndGetAgent,
  uniqueEmail,
  type ErrorResponseBody,
  type UserResponseBody,
} from './support/test-data';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTaggedTestData(app.get(PrismaService));
    await app.close();
  });

  it('signs up a new user and sets session + CSRF cookies', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer() as Server)
      .post('/auth/signup')
      .send({
        email,
        password: 'correct-horse-battery-staple',
        name: 'Test User',
        orgName: 'Test Org',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('userId');
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('agenttrace_session='))).toBe(
      true,
    );
    expect(setCookie.some((c) => c.startsWith('agenttrace_csrf='))).toBe(true);
  });

  it('rejects a second signup with the same email', async () => {
    const email = uniqueEmail();
    const server = app.getHttpServer() as Server;
    const signupBody = {
      email,
      password: 'correct-horse-battery-staple',
      name: 'Test User',
      orgName: 'Test Org',
    };

    await request(server).post('/auth/signup').send(signupBody);
    const second = await request(server).post('/auth/signup').send(signupBody);

    expect(second.status).toBe(409);
  });

  it('logs in successfully with the correct password', async () => {
    const email = uniqueEmail();
    const server = app.getHttpServer() as Server;
    const password = 'correct-horse-battery-staple';
    await request(server)
      .post('/auth/signup')
      .send({ email, password, name: 'Test User', orgName: 'Test Org' });

    const res = await request(server)
      .post('/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('userId');
  });

  // The security rule this project holds itself to: a login failure
  // never reveals whether the email is registered. Proven here by
  // comparing the two real HTTP responses directly, not by reading the
  // source and trusting it says the right thing.
  it('returns the identical error for a wrong password and an unknown email', async () => {
    const server = app.getHttpServer() as Server;
    const registeredEmail = uniqueEmail();
    await request(server).post('/auth/signup').send({
      email: registeredEmail,
      password: 'correct-horse-battery-staple',
      name: 'Test User',
      orgName: 'Test Org',
    });

    const wrongPassword = await request(server)
      .post('/auth/login')
      .send({ email: registeredEmail, password: 'not-the-right-password' });
    const unknownEmail = await request(server)
      .post('/auth/login')
      .send({ email: uniqueEmail(), password: 'literally-anything' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(body<ErrorResponseBody>(wrongPassword).message).toBe(
      body<ErrorResponseBody>(unknownEmail).message,
    );
  });

  it('logs out and clears the session cookie', async () => {
    const { agent } = await signupAndGetAgent(app);

    const res = await agent.post('/auth/logout');

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('agenttrace_session=;'))).toBe(
      true,
    );

    // The cleared cookie actually stops authenticating, not just that
    // logout returned 200: the same agent (whose cookie jar now holds
    // the empty value logout just set) can no longer reach a
    // session-protected route.
    const me = await agent.get('/auth/me');
    expect(me.status).toBe(401);
  });

  it('GET /auth/me returns the authenticated user identity', async () => {
    const { agent, email } = await signupAndGetAgent(app);

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(200);
    expect(body<UserResponseBody>(res).email).toBe(email);
  });

  it('GET /auth/csrf sets a fresh CSRF cookie for an authenticated session', async () => {
    const { agent } = await signupAndGetAgent(app);

    const res = await agent.get('/auth/csrf');

    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('agenttrace_csrf='))).toBe(true);
  });

  it('rejects GET /auth/csrf with no session at all', async () => {
    const res = await request(app.getHttpServer() as Server).get('/auth/csrf');

    expect(res.status).toBe(401);
  });
});
