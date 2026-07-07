use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::Nvml;
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use sysinfo::{Components, Disks, System};

/// CPU usage is a delta between refreshes, so the `System` lives across calls.
/// `ticks`/`last_temp` throttle the expensive thermal read (see below).
///
/// IMPORTANT: only `System` is built here. `Disks` and, especially,
/// `Components` (thermal) enumerate via WMI on Windows, which `CoInitialize`s
/// the calling thread as multithreaded (MTA). This state is created during
/// `.setup()` on the *main* thread, and tao later needs that thread's COM
/// apartment to be single-threaded (STA) for `OleInitialize` at window
/// creation — doing WMI here crashes startup with `RPC_E_CHANGED_MODE`. So the
/// COM-touching handles are built per-sample inside `spawn_blocking`, on a
/// blocking worker thread, never here.
struct Monitor {
    sys: System,
    ticks: u64,
    last_temp: Option<f32>,
    /// Disk topology changes rarely; re-enumerated on the throttled tick and
    /// reused in between rather than rebuilt from scratch every poll.
    last_disks: Vec<DiskStats>,
}

#[derive(Clone)]
pub struct MonitorState {
    inner: Arc<Mutex<Monitor>>,
}

impl Default for MonitorState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Monitor {
                sys: System::new(),
                ticks: 0,
                last_temp: None,
                last_disks: Vec::new(),
            })),
        }
    }
}

/// NVML loads the NVIDIA driver library at runtime; init once, None if absent.
fn nvml() -> Option<&'static Nvml> {
    static NVML: OnceLock<Option<Nvml>> = OnceLock::new();
    NVML.get_or_init(|| Nvml::init().ok()).as_ref()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStats {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuStats {
    pub name: String,
    pub usage: u32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub temp_c: Option<u32>,
    pub power_w: Option<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_name: String,
    pub cpu_usage: f32,
    pub core_count: usize,
    pub cpu_temp_c: Option<f32>,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disks: Vec<DiskStats>,
    pub gpu: Option<GpuStats>,
}

fn gpu_stats() -> Option<GpuStats> {
    let device = nvml()?.device_by_index(0).ok()?;
    let memory = device.memory_info().ok()?;
    Some(GpuStats {
        name: device.name().unwrap_or_else(|_| "GPU".to_string()),
        usage: device.utilization_rates().map(|u| u.gpu).unwrap_or(0),
        mem_used: memory.used,
        mem_total: memory.total,
        temp_c: device.temperature(TemperatureSensor::Gpu).ok(),
        power_w: device.power_usage().ok().map(|mw| mw as f32 / 1000.0),
    })
}

/// Best-effort CPU temperature: Windows rarely exposes thermal sensors to
/// userland, so this is often None there.
fn cpu_temp(components: &Components) -> Option<f32> {
    let mut fallback = None;
    for component in components {
        let label = component.label().to_ascii_lowercase();
        let Some(temp) = component.temperature() else {
            continue;
        };
        if label.contains("cpu") || label.contains("tctl") || label.contains("package") {
            return Some(temp);
        }
        fallback.get_or_insert(temp);
    }
    fallback
}

#[tauri::command]
pub async fn system_stats(
    state: tauri::State<'_, MonitorState>,
) -> Result<SystemStats, String> {
    let inner = state.inner.clone();
    // Sampling blocks (device I/O + WMI), so keep it off the async worker
    // threads — and, per the note on `Monitor`, keep all WMI/COM work here on
    // the blocking pool rather than the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let mut m = inner.lock().unwrap_or_else(|e| e.into_inner());

        // CPU usage is the delta since the previous refresh (the poll interval).
        m.sys.refresh_cpu_usage();
        m.sys.refresh_memory();
        let cpu_name = m
            .sys
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_else(|| "CPU".to_string());
        let cpu_usage = m.sys.global_cpu_usage();
        let core_count = m.sys.cpus().len();
        let mem_used = m.sys.used_memory();
        let mem_total = m.sys.total_memory();

        // Thermal (WMI) and disk enumeration are the costly parts; sample both
        // every 3rd poll and reuse the last readings in between. The COM handles
        // are built and dropped within this call so they never cross threads.
        let heavy_sample = m.ticks % 3 == 0 || m.last_disks.is_empty();
        m.ticks = m.ticks.wrapping_add(1);

        if heavy_sample {
            m.last_disks = Disks::new_with_refreshed_list()
                .iter()
                .filter(|disk| disk.total_space() > 0)
                .map(|disk| DiskStats {
                    name: disk.name().to_string_lossy().to_string(),
                    mount: disk.mount_point().to_string_lossy().to_string(),
                    total: disk.total_space(),
                    available: disk.available_space(),
                })
                .collect();
        }
        let disks = m.last_disks.clone();

        let cpu_temp_c = if heavy_sample {
            let temp = cpu_temp(&Components::new_with_refreshed_list());
            m.last_temp = temp;
            temp
        } else {
            m.last_temp
        };

        SystemStats {
            cpu_name,
            cpu_usage,
            core_count,
            cpu_temp_c,
            mem_used,
            mem_total,
            disks,
            gpu: gpu_stats(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}
