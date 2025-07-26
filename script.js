import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Fungsi render React-like sederhana untuk HTML
function render(component) {
    const root = document.getElementById('app-root');
    if (root) {
        root.innerHTML = component;
        console.log("UI updated successfully."); // Log untuk debugging
        attachEventListeners(); // Panggil fungsi untuk melampirkan event listeners setelah rendering
    } else {
        console.error("Elemen 'app-root' tidak ditemukan."); // Log jika elemen tidak ditemukan
    }
}

// State management sederhana
let electricityKWh = 0;
let vehicleType = 'mobil';
let transportKm = 0;
let wasteKg = 0;
let dietType = 'daging';
let totalEmissions = 0;
let emissionBreakdown = {};
let treesEquivalent = 0;
let staticSuggestions = '';
let showInfoModal = false;

// Firebase states
let db = null;
let auth = null;
let userId = null;
let isAuthReady = false;

// Emission factors (simplified and example values, in kg CO2e per unit)
const EMISSION_FACTORS = {
    electricity: 0.5, // kg CO2e per kWh (example for coal-heavy grid)
    car: 0.18,        // kg CO2e per km (example for gasoline car)
    motorcycle: 0.08, // kg CO2e per km (example for gasoline motorcycle)
    publicTransport: 0.05, // kg CO2e per km (example for bus/train)
    waste: 0.5,       // kg CO2e per kg (example for landfill waste, assuming some methane)
    diet: {           // kg CO2e per month (simplified averages)
        daging: 250,    // High meat consumption
        vegetarian: 100, // Vegetarian diet
        vegan: 50       // Vegan diet
    }
};

// Faktor konversi untuk pohon: 1 pohon dewasa menyerap sekitar 21 kg CO2 per tahun
const CO2_PER_TREE_PER_YEAR = 21; // kg CO2 per pohon per tahun

// Fungsi untuk menghasilkan saran statis berdasarkan rincian emisi
const getStaticSuggestions = (breakdown) => {
    if (Object.keys(breakdown).length === 0 || totalEmissions === 0) {
        return "Hitung jejak karbon Anda untuk mendapatkan saran personalisasi!";
    }

    let highestCategory = '';
    let highestEmission = 0;

    for (const category in breakdown) {
        if (breakdown[category] > highestEmission) {
            highestEmission = breakdown[category];
            highestCategory = category;
        }
    }

    let suggestions = "Berikut adalah beberapa saran untuk mengurangi jejak karbon Anda:\n\n";

    switch (highestCategory) {
        case 'listrik':
            suggestions += "Fokus pada penghematan listrik:\n";
            suggestions += "- Matikan lampu dan peralatan elektronik saat tidak digunakan.\n";
            suggestions += "- Cabut charger dan perangkat yang tidak digunakan (phantom load).\n";
            suggestions += "- Gunakan lampu LED yang hemat energi.\n";
            suggestions += "- Manfaatkan cahaya alami sebisa mungkin.\n";
            suggestions += "- Pertimbangkan untuk menggunakan peralatan elektronik hemat energi.\n";
            break;
        case 'transportasi':
            suggestions += "Fokus pada pengurangan emisi transportasi:\n";
            suggestions += "- Gunakan transportasi umum lebih sering.\n";
            suggestions += "- Berjalan kaki atau bersepeda untuk jarak dekat.\n";
            suggestions += "- Pertimbangkan untuk carpooling atau berbagi kendaraan.\n";
            suggestions += "- Rawat kendaraan Anda agar efisien bahan bakar.\n";
            suggestions += "- Jika memungkinkan, pertimbangkan kendaraan listrik atau hibrida.\n";
            break;
        case 'sampah':
            suggestions += "Fokus pada pengelolaan sampah yang lebih baik:\n";
            suggestions += "- Kurangi penggunaan produk sekali pakai, terutama plastik.\n";
            suggestions += "- Daur ulang sampah anorganik (plastik, kertas, logam, kaca).\n";
            suggestions += "- Kompos sampah organik untuk pupuk.\n";
            suggestions += "- Beli produk dengan kemasan minimal atau dapat didaur ulang.\n";
            suggestions += "- Perbaiki barang yang rusak daripada langsung membuangnya.\n";
            break;
        case 'makanan':
            suggestions += "Fokus pada pola makan yang lebih berkelanjutan:\n";
            suggestions += "- Kurangi konsumsi daging merah dan produk susu.\n";
            suggestions += "- Tingkatkan konsumsi makanan nabati, seperti sayuran, buah-buahan, dan biji-bijian.\n";
            suggestions += "- Beli makanan lokal dan musiman untuk mengurangi jejak transportasi.\n";
            suggestions += "- Hindari membuang-buang makanan.\n";
            suggestions += "- Pertimbangkan untuk menanam makanan Anda sendiri jika memungkinkan.\n";
            break;
        default:
            suggestions += "Secara umum, Anda bisa:\n";
            suggestions += "- Hemat energi di rumah dan tempat kerja.\n";
            suggestions += "- Pilih transportasi yang lebih ramah lingkungan.\n";
            suggestions += "- Kurangi dan daur ulang sampah Anda.\n";
            suggestions += "- Adopsi pola makan yang lebih berkelanjutan.\n";
            suggestions += "- Dukung energi terbarukan dan inisiatif hijau di komunitas Anda.\n";
            break;
    }
    suggestions += "\nSetiap langkah kecil berarti besar! Mari bersama menciptakan Indonesia bebas emisi.";
    return suggestions;
};

// Fungsi untuk menghitung emisi
const calculateEmissions = () => {
    let electricityEmissions = 0;
    let transportEmissions = 0;
    let wasteEmissions = 0;
    let dietEmissions = 0;

    // Hitung emisi listrik
    if (electricityKWh) {
        electricityEmissions = parseFloat(electricityKWh) * EMISSION_FACTORS.electricity;
    }

    // Hitung emisi transportasi
    if (transportKm) {
        const distance = parseFloat(transportKm);
        switch (vehicleType) {
            case 'mobil':
                transportEmissions = distance * EMISSION_FACTORS.car;
                break;
            case 'motor':
                transportEmissions = distance * EMISSION_FACTORS.motorcycle;
                break;
            case 'umum':
                transportEmissions = distance * EMISSION_FACTORS.publicTransport;
                break;
            case 'sepeda/jalan kaki':
                transportEmissions = 0; // Tidak ada emisi langsung
                break;
            default:
                break;
        }
    }

    // Hitung emisi sampah
    if (wasteKg) {
        wasteEmissions = parseFloat(wasteKg) * EMISSION_FACTORS.waste * 4; // Asumsi 4 minggu dalam sebulan
    }

    // Hitung emisi diet
    dietEmissions = EMISSION_FACTORS.diet[dietType] || 0;

    const total = electricityEmissions + transportEmissions + wasteEmissions + dietEmissions;

    totalEmissions = total;
    emissionBreakdown = {
        listrik: electricityEmissions,
        transportasi: transportEmissions,
        sampah: wasteEmissions,
        makanan: dietEmissions,
    };

    // Hitung ekuivalen pohon
    const annualEmissions = total * 12; // Emisi tahunan
    treesEquivalent = annualEmissions / CO2_PER_TREE_PER_YEAR;

    // Set static suggestions based on new breakdown
    staticSuggestions = getStaticSuggestions(emissionBreakdown);
    updateUI(); // Perbarui UI setelah perhitungan
};

// Fungsi untuk mengatur ulang semua input dan hasil
const resetCalculator = () => {
    electricityKWh = 0; // Reset ke 0
    vehicleType = 'mobil';
    transportKm = 0; // Reset ke 0
    wasteKg = 0; // Reset ke 0
    dietType = 'daging';
    totalEmissions = 0;
    emissionBreakdown = {};
    treesEquivalent = 0;
    staticSuggestions = '';
    updateUI(); // Perbarui UI setelah reset
};

// Placeholder for saving data to Firestore (future enhancement)
const saveData = async () => {
    if (!db || !userId || !isAuthReady) {
        console.warn("Firebase not ready or user not authenticated. Cannot save data.");
        return;
    }
    try {
        const dataToSave = {
            electricityKWh,
            vehicleType,
            transportKm,
            wasteKg,
            dietType,
            totalEmissions,
            emissionBreakdown,
            treesEquivalent,
            timestamp: new Date().toISOString(),
        };
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/carbonCalculations`, `calc-${Date.now()}`);
        await setDoc(docRef, dataToSave);
        console.log("Data saved successfully!");
    } catch (error) {
        console.error("Error saving data to Firestore:", error);
    }
};

// Fungsi untuk melampirkan event listeners secara programatis
function attachEventListeners() {
    // Input fields
    document.getElementById('electricity')?.addEventListener('change', (e) => { electricityKWh = parseFloat(e.target.value) || 0; updateUI(); });
    document.getElementById('transportKm')?.addEventListener('change', (e) => { transportKm = parseFloat(e.target.value) || 0; updateUI(); });
    document.getElementById('vehicleType')?.addEventListener('change', (e) => { vehicleType = e.target.value; updateUI(); });
    document.getElementById('waste')?.addEventListener('change', (e) => { wasteKg = parseFloat(e.target.value) || 0; updateUI(); });
    document.getElementById('diet')?.addEventListener('change', (e) => { dietType = e.target.value; updateUI(); });

    // Buttons
    // Menggunakan ID yang spesifik untuk tombol
    document.getElementById('calculateButton')?.addEventListener('click', calculateEmissions);
    document.getElementById('resetButton')?.addEventListener('click', resetCalculator);
    document.getElementById('infoButton')?.addEventListener('click', () => { showInfoModal = true; updateUI(); });

    // Modal close buttons (pastikan ID ini ada di HTML)
    document.getElementById('modalCloseButton')?.addEventListener('click', () => { showInfoModal = false; updateUI(); });
    document.getElementById('modalOverlayCloseButton')?.addEventListener('click', () => { showInfoModal = false; updateUI(); });

    console.log("Event listeners re-attached.");
}

// Membuat fungsi-fungsi utama tersedia secara global agar dapat diakses oleh HTML dan event listener
window.updateUI = updateUI;
window.calculateEmissions = calculateEmissions;
window.resetCalculator = resetCalculator;
window.saveData = saveData; // Jika Anda ingin menggunakan fungsi saveData dari HTML

// Inisialisasi Firebase dan tangani otentikasi
document.addEventListener('DOMContentLoaded', async () => {
    // Panggil updateUI() di sini untuk merender UI awal setelah DOM siap
    updateUI();

    try {
        // Dapatkan ID aplikasi dan konfigurasi Firebase dari variabel global
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        // Inisialisasi aplikasi Firebase
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Dengarkan perubahan status otentikasi
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
            } else {
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                        userId = auth.currentUser?.uid;
                    } else {
                        await signInAnonymously(auth);
                        userId = auth.currentUser?.uid || crypto.randomUUID();
                    }
                } catch (error) {
                    console.error("Error selama masuk Firebase:", error);
                    userId = crypto.randomUUID();
                }
            }
            isAuthReady = true;
            updateUI(); // Perbarui UI setelah otentikasi siap
        });
    } catch (error) {
        console.error("Gagal menginisialisasi Firebase:", error);
        userId = crypto.randomUUID();
        isAuthReady = true;
        updateUI();
    }
});
