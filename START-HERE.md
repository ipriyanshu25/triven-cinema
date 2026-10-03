# START HERE

## A. Run the complete app locally without GPU cost

```bash
cp .env.example .env
docker compose up -d db
npm install
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`.

Leave these values enabled for the first test:

```env
MOCK_MODE="true"
NEXT_PUBLIC_MOCK_MODE="true"
```

The UI, Prisma database, storyboard API, generation history and result player will work using the included mock MP4.

## B. Turn on real LTX-2.5 rendering

1. Accept access to `Lightricks/LTX-2.5-Diffusers` on Hugging Face and create a read token.
2. Create a Cloudflare R2 bucket and public/custom-domain URL.
3. Install/authenticate Modal:

```bash
python3 -m pip install modal
modal setup
```

4. Create the Modal runtime secret using the exact command template in `README.md`.
5. Cache the model on CPU:

```bash
modal run modal/cinema.py::prefetch_models
```

6. Deploy the API:

```bash
modal deploy modal/cinema.py
```

7. Copy the deployed Modal URL into `.env`, then change:

```env
MOCK_MODE="false"
NEXT_PUBLIC_MOCK_MODE="false"
MODAL_API_URL="https://YOUR-MODAL-ENDPOINT"
MODAL_WEB_SECRET="YOUR_SHARED_SECRET"
```

8. Restart:

```bash
npm run dev
```

9. First paid render: Direct / 16:9 / Preview / 5 seconds.

Read `README.md` for the full deployment, R2, database, architecture and troubleshooting guide.
