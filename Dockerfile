# syntax=docker/dockerfile:1

# Frontenden bygges i node og kopieres derefter over. Node er ikke med i det
# færdige billede, så kørslen indeholder kun Python og de byggede filer.
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM python:3.13-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /build/dist ./frontend-dist

# Indholdet monteres udefra, så en rettelse i en procedure ikke kræver et nyt
# billede. Databasen ligger på et volume, så den overlever en genopbygning.
ENV UBS_FRONTEND_DIST=/app/frontend-dist \
    UBS_CONTENT_DIR=/content \
    UBS_DB_PATH=/data/ubs.db

# Kører som almindelig bruger. Containeren har intet ærinde som root, og den
# skal kun læse fra VideometerLabs mapper.
RUN useradd --create-home --uid 10001 ubs \
    && mkdir -p /data \
    && chown -R ubs:ubs /data /app
USER ubs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

# proxy-headers gør at appen ser den rigtige klient og det rigtige skema, når
# den står bag en reverse proxy. Uden det tror den, alle kald kommer fra
# proxyen over http.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
