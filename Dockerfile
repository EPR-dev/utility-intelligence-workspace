FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /app/backend/requirements.txt

COPY frontend/package.json frontend/package-lock.json /app/frontend/
WORKDIR /app/frontend
RUN npm ci

COPY . /app

ARG NEXT_PUBLIC_CARTO_API_KEY
ENV NEXT_PUBLIC_CARTO_API_KEY=${NEXT_PUBLIC_CARTO_API_KEY}

WORKDIR /app/frontend
RUN npm run build

WORKDIR /app
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

RUN sed -i 's/\r$//' /app/scripts/start-prod.sh && chmod +x /app/scripts/start-prod.sh
CMD ["/app/scripts/start-prod.sh"]
