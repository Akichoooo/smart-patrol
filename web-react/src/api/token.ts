/**
 * Token 存取（独立小模块，打破 store/auth ↔ api/http 的循环依赖）：
 * http.ts 只依赖这里，不再引用 zustand store。
 */
const TOKEN_KEY = 'patrol_access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
