/* ---------- Bill attachments: photo/PDF upload to Firebase Storage (added 2026-10-01) ----------
   Binary files don't fit Firestore's 1 MiB document cap or localStorage's
   quota, so attachments live in actual Cloud Storage instead -- the one
   place this app uses a Firebase service other than Firestore. Only the
   resulting download URL (plus the Storage path, for later deletion) gets
   stored on the bill entry itself, same "small document, external blob"
   split Reports/Vendor Ledger already rely on for nothing being too big. */

const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024; // hard cap, mainly to catch an accidental huge file
const ATTACHMENT_IMAGE_MAX_DIM = 1600; // longest side, px
const ATTACHMENT_IMAGE_QUALITY = 0.75;

function isImageFile(file){ return file.type.startsWith('image/'); }
function isPdfFile(file){ return file.type === 'application/pdf'; }

// Downscales + re-encodes an image client-side before upload -- a phone
// camera photo can be 5-10+ MB, which is slow to upload AND slow to view
// later on restaurant wifi/mobile data. PDFs pass through unchanged (no
// cheap way to recompress them client-side without a PDF library).
async function compressImageFile(file){
  if(!isImageFile(file)) return file;
  try{
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, ATTACHMENT_IMAGE_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', ATTACHMENT_IMAGE_QUALITY));
    if(!blob) return file; // compression failed for some reason -- fall back to the original
    // A small source image re-encoded as JPEG can sometimes end up bigger --
    // only use the compressed version when it actually saved something.
    return blob.size < file.size
      ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
      : file;
  }catch(e){
    console.error("image compression failed, uploading original", e);
    return file;
  }
}

function sanitizeFilename(name){
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

// Uploads one bill attachment and returns {url, path, name, type} to store
// on the bill entry. `path` is the Storage object path, kept so the file
// can be deleted later if the bill is deleted or the attachment replaced.
async function uploadBillAttachment(restaurantId, billId, file){
  if(file.size > ATTACHMENT_MAX_BYTES){
    throw new Error(`That file is too large (${(file.size/1024/1024).toFixed(1)} MB) — the limit is ${ATTACHMENT_MAX_BYTES/1024/1024} MB.`);
  }
  const toUpload = await compressImageFile(file);
  const storage = await initFirebaseStorage();
  if(!storage) throw new Error("Couldn't reach cloud storage to upload the attachment — check your connection and try again.");
  const path = `rest/${restaurantId}/bills/${billId}/${Date.now()}_${sanitizeFilename(toUpload.name)}`;
  const ref = storage.ref(path);
  await ref.put(toUpload, { contentType: toUpload.type });
  const url = await ref.getDownloadURL();
  return { url, path, name: file.name, type: isPdfFile(file) ? 'pdf' : 'image' };
}

// Best-effort delete -- used when a bill is deleted or its attachment is
// replaced/removed. Swallows errors (e.g. already gone) since a dangling
// Storage file costs a little quota but should never block the user's
// actual bill-editing action.
async function deleteBillAttachmentByPath(path){
  if(!path) return;
  try{
    const storage = await initFirebaseStorage();
    if(!storage) return;
    await storage.ref(path).delete();
  }catch(e){
    console.error("attachment delete failed (non-fatal)", e);
  }
}

/* ---------- Shared preview-chip UI wiring, used by both the Add Expenses
   quick-add form and the Modify-bill dialog ---------- */
// Wires up a {takePhotoBtn, takePhotoInput, attachFileBtn, attachFileInput,
// preview, previewImg, previewName, removeBtn} id set so picking a file
// (camera or file picker) shows a filename + thumbnail chip with a remove
// button, and exposes get/set/clear so the caller's submit handler can read
// the currently-picked File. Returns {getFile, setExisting, clear}.
function wireAttachmentPicker(ids){
  let pendingFile = null;
  let objectUrl = null;
  let hadExisting = false; // set by showExisting() -- an attachment already saved on this entry when the dialog opened

  const preview = document.getElementById(ids.preview);
  const previewImg = document.getElementById(ids.previewImg);
  const previewName = document.getElementById(ids.previewName);
  const removeBtn = document.getElementById(ids.removeBtn);
  const takePhotoInput = document.getElementById(ids.takePhotoInput);
  const attachFileInput = document.getElementById(ids.attachFileInput);

  // `linkUrl` is only set for an already-saved attachment being shown on
  // open (Modify dialog) -- a newly-picked, not-yet-uploaded file has no
  // permanent URL yet, so its name is shown as plain text instead.
  function showPreview(name, imgSrc, linkUrl){
    if(linkUrl){
      previewName.innerHTML = "";
      const a = document.createElement('a');
      a.href = linkUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = name;
      previewName.appendChild(a);
    } else {
      previewName.textContent = name;
    }
    if(imgSrc){
      previewImg.src = imgSrc;
      previewImg.style.display = '';
    } else {
      previewImg.style.display = 'none';
      previewImg.removeAttribute('src');
    }
    preview.style.display = 'flex';
  }
  // Clears any picked/previewed file -- does NOT touch `hadExisting`, since
  // this also runs on the remove-button click, where losing that flag would
  // break wasExistingRemoved()'s read right afterward.
  function resetPreview(){
    pendingFile = null;
    if(objectUrl){ URL.revokeObjectURL(objectUrl); objectUrl = null; }
    preview.style.display = 'none';
    previewImg.style.display = 'none';
    previewImg.removeAttribute('src');
    previewName.textContent = '';
    takePhotoInput.value = '';
    attachFileInput.value = '';
  }
  function handleFile(file){
    if(!file) return;
    if(objectUrl){ URL.revokeObjectURL(objectUrl); objectUrl = null; }
    pendingFile = file;
    if(isImageFile(file)){
      objectUrl = URL.createObjectURL(file);
      showPreview(file.name, objectUrl);
    } else {
      showPreview(file.name, null);
    }
  }

  document.getElementById(ids.takePhotoBtn).addEventListener('click', ()=> takePhotoInput.click());
  document.getElementById(ids.attachFileBtn).addEventListener('click', ()=> attachFileInput.click());
  takePhotoInput.addEventListener('change', ()=> handleFile(takePhotoInput.files[0]));
  attachFileInput.addEventListener('change', ()=> handleFile(attachFileInput.files[0]));
  removeBtn.addEventListener('click', resetPreview);

  return {
    getFile: () => pendingFile,
    // Full reset for closing the dialog / after a successful save / before
    // opening on a different entry -- forgets hadExisting too.
    reset(){ resetPreview(); hadExisting = false; },
    // Shows an already-saved attachment (Modify dialog, opening on an entry
    // that already has one) without treating it as a new file to upload --
    // the name links to `url` so it can still be viewed full-size/as-is.
    showExisting(name, url, isImage){ hadExisting = true; showPreview(name, isImage ? url : null, url); },
    // True only when an attachment was present on open, nothing new was
    // picked, and the user explicitly cleared it with the remove button --
    // distinct from "never had one" and from "replaced with a new file"
    // (both of which the caller reads from getFile()/the saved entry).
    wasExistingRemoved: () => hadExisting && !pendingFile && preview.style.display === 'none'
  };
}
