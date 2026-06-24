# Backend pzemeter - Node.js
# Pakai base Debian (glibc), bukan Alpine (musl).
# Alasan: prebuilt binary bcrypt dibuat utk glibc; di Alpine/musl ia
# segfault (SIGSEGV / exit 139). node:20-slim memakai glibc sehingga
# prebuilt bcrypt jalan tanpa perlu kompilasi native.
FROM node:20-slim

WORKDIR /app

# Install dependencies dulu (cache layer)
COPY backend/package.json ./
RUN npm install --omit=dev

# Salin source backend
COPY backend/ ./

# Salin frontend statis (di-serve oleh express)
COPY frontend/ ../frontend/

# Jalankan sebagai user non-root (OWASP - least privilege)
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
