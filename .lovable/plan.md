
# Fix: PDF always in Russian + embed images in PDF

## Problem Analysis

Three distinct issues exist:

**Issue 1 — Garbled text in PDF**
The `loadRobotoFont()` function tries to fetch the font TTF from GitHub raw URLs. These requests fail in the Deno edge runtime (network restrictions, rate limits, or CORS), causing a silent fallback to `transliterate()`. However, the transliteration itself doesn't help because the default PDF font can't even display Latin characters from the fallback — it produces garbage like `> 0 > 2 ; C ;`.

Root cause: The font never loads, and the default jsPDF font (Helvetica/Courier) cannot render anything beyond basic ASCII correctly when it receives Unicode strings.

**Issue 2 — Images missing from PDF**
Current flow:
1. Server generates PDF (no images yet)
2. Server saves PDF to Storage + creates notification
3. Client uploads images to Storage **after** server responds (fire-and-forget)

The images arrive in Storage **after** the PDF is already finalized. The server never sees them.

**Issue 3 — PDF language should always be Russian**
User requirement: The PDF labels/headers must always use Russian, regardless of what language the form was filled in.

---

## Solution

### Fix 1: Reliable font loading — use the Roboto font from Supabase Storage

The font file `Roboto-Regular.ttf` already exists in `public/fonts/Roboto-Regular.ttf`. The fix is to:
1. Upload `Roboto-Regular.ttf` to the `documents` Supabase Storage bucket (path: `fonts/Roboto-Regular.ttf`) so the Edge Function can reliably download it using the service role client.
2. In `generateAndUploadPdf`, download the font from Storage instead of an external CDN.

This guarantees the font is always available without external network dependency.

### Fix 2: Upload images BEFORE calling the server

Change the client flow in `handleSubmit`:
1. Upload signature + all images to temp paths first
2. Pass all temp image paths (`tempImgPaths`) to `submit-public-payout`
3. Server downloads each image, embeds it on a new PDF page, then saves the final PDF

The Edge Function already has the signature pre-upload pattern working. We extend this to images.

### Fix 3: Force Russian labels in PDF

In `generateAndUploadPdf`, ignore the `language` parameter for PDF labels — always use `pdfLabels['ru']`.

---

## Technical Changes

### `supabase/functions/submit-public-payout/index.ts`

1. Add `tempImgPaths?: string[]` to `SubmitPayoutRequest` interface
2. Pass `tempImgPaths` into `generateAndUploadPdf`
3. In `generateAndUploadPdf`:
   - Always use `pdfLabels['ru']` (Russian labels regardless of language param)
   - Replace `loadRobotoFont()` with a Storage download: `supabase.storage.from('documents').download('fonts/Roboto-Regular.ttf')`
   - After signature page, loop through `tempImgPaths`, download each, add to PDF as a new page
   - Clean up temp image paths after embedding
4. Validate `tempImgPaths` (array, max 10 items, each a valid storage path)

### `src/pages/PublicPayout.tsx` — `handleSubmit`

Change the sequence:
1. Upload signature to temp path (already done)
2. **NEW**: Upload all `attachedImages` to temp paths (`temp_{Date.now()}/image_1.jpg` etc.) and collect `tempImgPaths`
3. Call `submit-public-payout` with both `tempSigPath` and `tempImgPaths`
4. Remove the post-submit image upload block (no longer needed — server handles it)

### Font availability

A one-time migration/setup is needed: upload `public/fonts/Roboto-Regular.ttf` to Storage bucket `documents` at path `fonts/Roboto-Regular.ttf`. This is done via a small SQL migration using `storage.objects` insert or by adding a startup step to the Edge Function that checks and self-uploads the font from a reliable CDN if missing.

Since we can't run SQL migrations against the `storage` schema, the cleanest approach is: in `generateAndUploadPdf`, try Storage first, and if font not found, fetch from `https://raw.githubusercontent.com/googlefonts/roboto-2/main/fonts/ttf/Roboto-Regular.ttf` (a stable URL) and cache it in Storage for next time.

---

## Flow After Fix

```
Client (handleSubmit)
  │
  ├─ Upload signature → temp/{ts}/signature.png
  ├─ Upload image_1   → temp/{ts}/image_1.jpg
  ├─ Upload image_2   → temp/{ts}/image_2.jpg
  │
  └─ POST submit-public-payout {
       tempSigPath, tempImgPaths: [...], language: 'ru', ...
     }
       │
       ├─ Create transaction in DB
       ├─ Download Roboto font from Storage (or cache to Storage)
       ├─ Generate PDF page 1 (document with signature) — always in Russian
       ├─ Add image_1 as page 2
       ├─ Add image_2 as page 3
       ├─ Upload final PDF → {ownerId}/{txId}/payout_{date}_{prefix}.pdf
       ├─ Clean up temp files
       ├─ Create notification with pdf_path set
       └─ Send to Telegram
```

---

## Files to Change

- `supabase/functions/submit-public-payout/index.ts` — main logic
- `src/pages/PublicPayout.tsx` — pre-upload images, pass tempImgPaths
