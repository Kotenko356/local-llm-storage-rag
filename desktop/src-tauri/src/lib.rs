use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

// ── Structures ────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkMeta {
    role: String,
    #[serde(default, alias = "conversationId")]
    conversation_id: Option<String>,
    #[serde(default)]
    timestamp: Option<u64>,
    #[serde(default, alias = "messageIndex")]
    message_index: Option<u32>,
}

#[derive(Deserialize)]
struct Chunk {
    v: Vec<f64>,
    text: String,
    meta: ChunkMeta,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dump {
    version: u32,
    #[serde(default)]
    saved_at: String,
    chunks: HashMap<String, Chunk>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    version: u32,
    saved_at: String,
    chunk_count: usize,
    conversation_count: usize,
    estimated_ram_kb: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChunkInfo {
    id: String,
    text: String,
    role: String,
    similarity: f64,
    conversation_id: Option<String>,
    timestamp: Option<u64>,
    message_index: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSummary {
    id: String,
    chunk_count: usize,
    roles: Vec<String>,
    first_ts: Option<u64>,
    last_ts: Option<u64>,
}

// ── Helpers ────────────────────────────────────────────────

fn load_dump(path: &str) -> Result<Dump, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Cannot read file: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {e}"))
}

fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f64 = a.iter().map(|x| x * x).sum();
    let nb: f64 = b.iter().map(|x| x * x).sum();
    dot / (na.sqrt() * nb.sqrt())
}

fn chunk_to_info(id: &str, chunk: &Chunk, similarity: f64) -> ChunkInfo {
    ChunkInfo {
        id: id.to_string(),
        text: chunk.text.clone(),
        role: chunk.meta.role.clone(),
        similarity,
        conversation_id: chunk.meta.conversation_id.clone(),
        timestamp: chunk.meta.timestamp,
        message_index: chunk.meta.message_index,
    }
}

// ── Tauri Commands ────────────────────────────────────────

#[tauri::command]
fn read_stats(path: String) -> Result<Stats, String> {
    let dump = load_dump(&path)?;
    let conversations: HashSet<&str> = dump
        .chunks
        .values()
        .filter_map(|c| c.meta.conversation_id.as_deref())
        .collect();

    let saved_at = dump.saved_at.clone();

    // ~3 KB per chunk: vector (768 × f64 = 6 KB) + text + meta ≈ 7 KB total worst case
    let estimated_ram_kb = (dump.chunks.len() as u64) * 7;

    Ok(Stats {
        version: dump.version,
        saved_at,
        chunk_count: dump.chunks.len(),
        conversation_count: conversations.len(),
        estimated_ram_kb,
    })
}

#[tauri::command]
fn search_chunks(path: String, query: String, top_k: Option<usize>) -> Result<Vec<ChunkInfo>, String> {
    let dump = load_dump(&path)?;
    let query_lower = query.to_lowercase();

    let mut results: Vec<ChunkInfo> = dump
        .chunks
        .iter()
        .filter(|(_, c)| c.text.to_lowercase().contains(&query_lower))
        .map(|(id, c)| chunk_to_info(id, c, 1.0))
        .collect();

    let top = top_k.unwrap_or(50);
    results.truncate(top);
    Ok(results)
}

#[tauri::command]
fn get_related(path: String, chunk_id: String, threshold: f64, top_k: Option<usize>) -> Result<Vec<ChunkInfo>, String> {
    let dump = load_dump(&path)?;

    let target = dump
        .chunks
        .get(&chunk_id)
        .ok_or_else(|| format!("Chunk {chunk_id} not found"))?;

    let mut results: Vec<ChunkInfo> = dump
        .chunks
        .iter()
        .filter(|(id, _)| *id != &chunk_id)
        .map(|(id, c)| {
            let sim = cosine_similarity(&target.v, &c.v);
            (id, c, sim)
        })
        .filter(|(_, _, sim)| *sim >= threshold)
        .map(|(id, c, sim)| chunk_to_info(id, c, sim))
        .collect();

    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

    let top = top_k.unwrap_or(20);
    results.truncate(top);
    Ok(results)
}

#[tauri::command]
fn list_conversations(path: String) -> Result<Vec<ConversationSummary>, String> {
    let dump = load_dump(&path)?;

    let mut convs: HashMap<String, ConversationSummary> = HashMap::new();

    for chunk in dump.chunks.values() {
        let cid = chunk.meta.conversation_id.clone().unwrap_or("__unknown__".into());

        let entry = convs.entry(cid.clone()).or_insert(ConversationSummary {
            id: cid,
            chunk_count: 0,
            roles: vec![],
            first_ts: None,
            last_ts: None,
        });

        entry.chunk_count += 1;
        if !entry.roles.contains(&chunk.meta.role) {
            entry.roles.push(chunk.meta.role.clone());
        }
        if let Some(ts) = chunk.meta.timestamp {
            if entry.first_ts.map_or(true, |f| ts < f) {
                entry.first_ts = Some(ts);
            }
            if entry.last_ts.map_or(true, |l| ts > l) {
                entry.last_ts = Some(ts);
            }
        }
    }

    let mut result: Vec<ConversationSummary> = convs.into_values().collect();
    result.sort_by(|a, b| b.chunk_count.cmp(&a.chunk_count));
    Ok(result)
}

#[tauri::command]
fn backup_and_clear(path: String) -> Result<(), String> {
    let backup_path = format!("{}.bak", path);

    if Path::new(&backup_path).exists() {
        fs::remove_file(&backup_path).map_err(|e| format!("Cannot remove old backup: {e}"))?;
    }

    fs::rename(&path, &backup_path).map_err(|e| format!("Cannot backup file: {e}"))?;

    let empty_dump = serde_json::json!({
        "version": 1,
        "savedAt": chrono_now(),
        "chunks": {}
    });

    let content = serde_json::to_string_pretty(&empty_dump)
        .map_err(|e| format!("Serialize error: {e}"))?;

    fs::write(&path, content).map_err(|e| format!("Cannot write empty dump: {e}"))?;

    Ok(())
}

#[tauri::command]
fn dump_exists(path: String) -> bool {
    Path::new(&path).exists()
}

fn chrono_now() -> String {
    // Manual ISO-8601 without chrono dependency
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Simple UTC timestamp
    format!("{}", secs)
}

// ── App Entry ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_stats,
            search_chunks,
            get_related,
            list_conversations,
            backup_and_clear,
            dump_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
