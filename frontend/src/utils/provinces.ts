// Türkiye coğrafi bölgeleri ve il adı normalizasyonu — TEK kaynak.
// App.tsx ve Map.tsx buradan import eder.

export const REGIONS: { [key: string]: string[] } = {
  "Marmara": [
    "balikesir", "bilecik", "bursa", "canakkale", "edirne", "istanbul",
    "kirklareli", "kocaeli", "sakarya", "tekirdag", "yalova"
  ],
  "Ege": [
    "afyonkarahisar", "aydin", "denizli", "izmir", "kutahya", "manisa",
    "mugla", "usak"
  ],
  "Akdeniz": [
    "adana", "antalya", "burdur", "hatay", "isparta", "mersin",
    "kahramanmaras", "osmaniye"
  ],
  "İç Anadolu": [
    "ankara", "cankiri", "eskisehir", "kayseri", "kirsehir", "konya",
    "nevsehir", "nigde", "sivas", "yozgat", "aksaray", "karaman", "kirikkale"
  ],
  "Karadeniz": [
    "amasya", "artvin", "bolu", "corum", "giresun", "gumushane", "ordu",
    "rize", "samsun", "sinop", "tokat", "trabzon", "bayburt", "bartin",
    "karabuk", "zonguldak", "duzce", "kastamonu"
  ],
  "Doğu Anadolu": [
    "agri", "bingol", "bitlis", "elazig", "erzincan", "erzurum", "hakkari",
    "kars", "malatya", "mus", "tunceli", "van", "ardahan", "igdir"
  ],
  "Güneydoğu Anadolu": [
    "adiyaman", "diyarbakir", "gaziantep", "mardin", "siirt", "sanliurfa",
    "batman", "sirnak", "kilis"
  ]
};

/**
 * İl adını normalize eder: Türkçe karakterleri ASCII'ye çevirir,
 * boşluk/noktalama kaldırır, bilinen varyasyonları standart adlara eşler.
 * GeoJSON normalized adları ile backend il adlarını eşleştirmek için kullanılır.
 */
export const normalizeProvinceName = (name: string): string => {
  if (!name) return '';
  const normalized = name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  // Bilinen varyasyon eşlemeleri (GeoJSON ile backend arasındaki farklar)
  if (normalized === 'urfa' || normalized === 'urdfa') return 'sanliurfa';
  if (normalized === 'kmaras' || normalized === 'maras') return 'kahramanmaras';
  if (normalized === 'elazi') return 'elazig';
  if (normalized === 'aksarat') return 'aksaray';
  if (normalized === 'izmit') return 'izmir'; // 2008 plaka 35 'izmit' olarak eşlenmiş
  if (normalized === 'kirikkalae') return 'kirikkale';
  if (normalized === 'mardim') return 'mardin';
  if (normalized === 'afyon') return 'afyonkarahisar';

  return normalized;
};
