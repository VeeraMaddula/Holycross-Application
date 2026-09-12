// AI image/video generation history (Design Studio — see
// src/routes/design.js and src/openArt.js). SQL-backed from the start —
// every function here is ASYNC, every caller must await it. Only metadata +
// the OpenArt CDN result URL are stored; the actual media stays hosted on
// OpenArt, never copied into our own database (see db/schema.sql's comment
// on this table for why).
const { query } = require('../sqlPool');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    prompt: r.prompt,
    model: r.model,
    status: r.status,
    resultUrl: r.result_url || '',
    openartCreationId: r.openart_creation_id || '',
    usedReference: r.used_reference,
    error: r.error || '',
    requestedByUserId: r.requested_by_user_id,
    requestedByName: r.requested_by_name || 'Unknown',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
  };
}

async function listGenerations(limit = 100) {
  const { rows } = await query(`SELECT * FROM design_generations ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(mapRow);
}

async function getGeneration(id) {
  const { rows } = await query(`SELECT * FROM design_generations WHERE id = $1`, [Number(id)]);
  return mapRow(rows[0]);
}

// Inserted as soon as a generation is submitted (status 'pending'), then
// updated once the OpenArt CLI call resolves — so a slow video generation
// still shows up in the history list immediately, not just once finished.
async function createGeneration({ kind, prompt, model, usedReference, requestedByUserId, requestedByName }) {
  const { rows } = await query(
    `INSERT INTO design_generations (kind, prompt, model, status, used_reference, requested_by_user_id, requested_by_name)
     VALUES ($1,$2,$3,'pending',$4,$5,$6) RETURNING id`,
    [kind, prompt, model, !!usedReference, requestedByUserId || null, requestedByName || 'Unknown']
  );
  return getGeneration(rows[0].id);
}

async function markGenerationComplete(id, { resultUrl, openartCreationId }) {
  await query(
    `UPDATE design_generations SET status = 'completed', result_url = $1, openart_creation_id = $2 WHERE id = $3`,
    [resultUrl || null, openartCreationId || null, Number(id)]
  );
  return getGeneration(id);
}

async function markGenerationFailed(id, errorMessage) {
  await query(`UPDATE design_generations SET status = 'failed', error = $1 WHERE id = $2`, [String(errorMessage || 'Unknown error').slice(0, 2000), Number(id)]);
  return getGeneration(id);
}

module.exports = {
  listGenerations, getGeneration, createGeneration, markGenerationComplete, markGenerationFailed
};
