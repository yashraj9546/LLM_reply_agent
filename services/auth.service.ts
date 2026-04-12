// src/services/auth.service.ts
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { config } from '../config/env';

const SALT_ROUNDS = 12;

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
  };
}

/**
 * Create a new merchant account.
 * Throws if the email is already registered.
 */
export async function signup(input: SignupInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    const err: NodeJS.ErrnoException = new Error('Email already in use');
    (err as any).statusCode = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
    },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  const token = signToken(user.id, user.email);
  return { token, user };
}

/**
 * Validate credentials and return a JWT.
 * Throws a 401 for any invalid combination (email not found, wrong password).
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    const err: any = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const passwordMatch = await bcrypt.compare(input.password, user.password);
  if (!passwordMatch) {
    const err: any = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const token = signToken(user.id, user.email);
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  };
}

/**
 * Fetch the logged-in user's profile (no password).
 */
export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      id: true, 
      name: true, 
      email: true, 
      createdAt: true,
      stores: {
        select: { id: true, shop: true, installedAt: true }
      }
    },
  });

  if (!user) {
    const err: any = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  return user;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function signToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as any,
  });
}
