import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS, MIN_PASSWORD_LENGTH } from "@/lib/defaults";

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  // bcryptjs throws on a malformed hash; a corrupted row must read as "wrong
  // password", never as an unhandled error on the login screen.
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Minimum complexity policy. Returns the problems in pt-BR so the same list can
 * be shown by the form and by the server action.
 */
export function passwordPolicyErrors(plain: string): string[] {
  const errors: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) {
    errors.push(`A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (!/[a-zA-Z]/.test(plain)) errors.push("A senha precisa de pelo menos uma letra.");
  if (!/[0-9]/.test(plain)) errors.push("A senha precisa de pelo menos um número.");
  if (/^\s|\s$/.test(plain)) errors.push("A senha não pode começar nem terminar com espaço.");
  return errors;
}

export function isPasswordAcceptable(plain: string): boolean {
  return passwordPolicyErrors(plain).length === 0;
}
