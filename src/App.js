import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, addDoc, updateDoc, deleteDoc, onSnapshot, collection } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


// Firebase Context untuk menyediakan instance ke seluruh komponen
const FirebaseContext = createContext(null);

// Custom Modal Component untuk menggantikan alert() dan window.confirm()
function CustomModal({ isOpen, title, message, type, onConfirm, onCancel }) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm border border-gray-700">
                <h3 className="text-xl font-bold text-gray-100 mb-4">{title}</h3>
                <p className="text-gray-300 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    {/* Tombol Batal hanya muncul untuk modal konfirmasi */}
                    {type === 'confirm' && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                        >
                            Batal
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 rounded-md transition-colors ${
                            type === 'confirm' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
                        } text-white`}
                    >
                        {type === 'confirm' ? 'Ya, Hapus' : 'Oke'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Utility function untuk ekspor data ke CSV
const exportToCSV = (data, filename, showModal) => {
    if (!data || data.length === 0) {
        // Menggunakan modal kustom untuk pesan "tidak ada data"
        showModal("Tidak Ada Data", "Tidak ada data untuk diekspor.", "alert", () => {});
        return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.map(header => `"${header}"`).join(','),
        ...data.map(row =>
            headers.map(header => {
                const value = row[header] === null || row[header] === undefined ? '' : row[header];
                const stringValue = String(value);
                // Escape double quotes by doubling them for CSV compatibility
                return `"${stringValue.replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Membersihkan URL objek
};


function App({ firebaseConfig: propFirebaseConfig, appId: propAppId }) { // Menerima firebaseConfig dan appId sebagai props
    // State untuk menyimpan instance firebase dan data pengguna
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [storage, setStorage] = useState(null);
    const [appId, setAppId] = useState(null); // appId sekarang adalah state
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // State untuk Custom Modal
    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState({ title: '', message: '', type: 'alert' });
    const [modalCallback, setModalCallback] = useState(() => () => {}); // Callback function untuk aksi modal (konfirmasi)

    // Fungsi untuk menampilkan modal kustom
    const showCustomModal = (title, message, type, onConfirm, onCancel = () => setShowModal(false)) => {
        setModalContent({ title, message, type });
        setModalCallback(() => onConfirm); // Simpan callback konfirmasi
        setShowModal(true);
    };

    useEffect(() => {
        const initializeAndAuth = async () => {
            let configToUse = propFirebaseConfig;
            let idToUse = propAppId;
            let initialTokenToUse = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

            // Prioritaskan variabel global jika tersedia (untuk lingkungan Canvas)
            if (typeof __firebase_config !== 'undefined' && typeof __app_id !== 'undefined') {
                try {
                    configToUse = JSON.parse(__firebase_config);
                    idToUse = __app_id;
                    console.log("Menggunakan konfigurasi dari variabel global Canvas.");
                } catch (e) {
                    console.error("Gagal parse __firebase_config dari variabel global:", e);
                    // Fallback ke props jika parsing gagal
                }
            } else {
                console.log("Menggunakan konfigurasi dari props (untuk pengembangan lokal).");
            }

            // Pastikan konfigurasi Firebase tersedia
            if (!configToUse || !idToUse) {
                const errorMessage = "Konfigurasi Firebase tidak ditemukan. Aplikasi tidak dapat berjalan.";
                console.error(errorMessage);
                setAuthError(errorMessage);
                setLoading(false);
                return;
            }

            try {
                // Inisialisasi Firebase dengan konfigurasi yang ditentukan
                const app = initializeApp(configToUse);
                const authInstance = getAuth(app);

                // Set semua instance ke state
                setDb(getFirestore(app));
                setAuth(authInstance);
                setStorage(getStorage(app));
                setAppId(idToUse); // Set appId ke state yang baru

                // Setup listener onAuthStateChanged SEBELUM mencoba login
                const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                    if (user) {
                        console.log("Pengguna terautentikasi dengan UID:", user.uid);
                        setUserId(user.uid);
                        setAuthError(null);
                    } else {
                        console.log("Tidak ada pengguna yang login.");
                        setUserId(null);
                    }
                    setLoading(false); // Selesai loading setelah status autentikasi diketahui
                });

                // Coba login dengan custom token jika tersedia.
                // Jika tidak, fallback ke login anonim.
                if (initialTokenToUse) {
                    console.log("Mencoba login dengan custom token...");
                    await signInWithCustomToken(authInstance, initialTokenToUse);
                } else {
                    console.log("Tidak ada custom token, mencoba login anonim...");
                    await signInAnonymously(authInstance);
                }

                // Jangan lupa cleanup listener saat komponen di-unmount
                return () => unsubscribe();

            } catch (error) {
                console.error("Gagal inisialisasi atau login:", error);
                setAuthError(`Gagal terhubung ke Firebase: ${error.message}`);
                setLoading(false);
            }
        };

        initializeAndAuth();
    }, [propFirebaseConfig, propAppId]); // Dependensi: re-run effect jika propFirebaseConfig atau propAppId berubah

    const handlePageChange = (page) => {
        setCurrentPage(page);
        setIsMobileMenuOpen(false); // Tutup menu mobile saat halaman berubah
    };

    // Mengembalikan path database ke format yang menggunakan appId dan userId
    // Ini penting untuk isolasi data per pengguna
    const getProductsCollectionRef = () => collection(db, `artifacts/${appId}/users/${userId}/products`);
    const getTransactionsCollectionRef = () => collection(db, `artifacts/${appId}/users/${userId}/transactions`);

    // Tampilan loading saat aplikasi sedang mengautentikasi
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900">
                <div className="text-xl font-semibold text-gray-200">Mengautentikasi...</div>
            </div>
        );
    }

    // Tampilan error jika autentikasi gagal atau userId tidak ditemukan
    if (authError || !userId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-rose-900 text-rose-100 p-4">
                <h2 className="text-2xl font-bold mb-4">Gagal Melakukan Autentikasi</h2>
                <p className="text-center mb-2">Aplikasi tidak dapat terhubung ke server. Pastikan Anda memiliki izin yang benar.</p>
                <p className="text-center font-mono bg-rose-800 p-2 rounded-md text-sm">Error: {authError || "User ID tidak ditemukan."}</p>
            </div>
        );
    }

    return (
        // Menyediakan instance Firebase dan fungsi showCustomModal ke seluruh komponen anak melalui Context
        <FirebaseContext.Provider value={{ db, auth, storage, userId, appId, getProductsCollectionRef, getTransactionsCollectionRef, showCustomModal }}>
            <div className="min-h-screen bg-gray-900 font-sans antialiased text-gray-200 flex flex-col">
                {/* Header Aplikasi */}
                <header className="bg-gradient-to-r from-purple-800 to-indigo-900 text-white p-4 shadow-xl">
                    <div className="container mx-auto flex justify-between items-center">
                        <div className="flex items-center space-x-3">
                            <img
                                src="https://astinhomeliving.com/wp-content/uploads/2025/08/logo-astin.jpeg"
                                alt="Logo Astin Management"
                                className="h-10 w-10 rounded-full object-cover shadow-md"
                                // Fallback image jika gambar tidak dapat dimuat
                                onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/40x40/ffffff/000000?text=AM'; }}
                            />
                            <h1 className="flex flex-col rounded-lg px-3 py-1 bg-white/10 hover:bg-white/20 transition-colors duration-300">
                                <span className="text-xl sm:text-lg font-bold font-serif leading-none">Astin</span>
                                <span className="text-lg sm:text-base italic font-sans leading-none">Management</span>
                            </h1>
                        </div>

                        {/* Tombol menu mobile */}
                        <div className="md:hidden">
                            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}></path>
                                </svg>
                            </button>
                        </div>

                        {/* Navigasi Desktop */}
                        <nav className="hidden md:block">
                            <ul className="flex space-x-4">
                                {['dashboard', 'products', 'financialReport', 'productReport'].map((page) => (
                                    <li key={page}>
                                        <button
                                            onClick={() => handlePageChange(page)}
                                            className={`px-4 py-2 rounded-lg transition-colors duration-300 ${currentPage === page ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-amber-500 hover:text-gray-900'}`}
                                        >
                                            {
                                                {
                                                    'dashboard': 'Dashboard',
                                                    'products': 'Produk & Stok',
                                                    'financialReport': 'Keuangan',
                                                    'productReport': 'Laporan'
                                                }[page]
                                            }
                                        </button>
                                    </li>
                                ))}
                                <li>
                                    <button
                                        onClick={() => window.open('https://astinhomeliving.com/', '_blank')}
                                        className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold shadow-md hover:bg-teal-700 transition-colors duration-300"
                                    >
                                        AstinShop
                                    </button>
                                </li>
                            </ul>
                        </nav>
                    </div>
                </header>

                {/* Overlay saat menu mobile terbuka */}
                {isMobileMenuOpen && (
                    <div className="fixed inset-0 bg-black bg-opacity-75 z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>
                )}

                {/* Navigasi Mobile (Sidebar) */}
                <nav className={`fixed top-0 right-0 h-full w-64 bg-gray-800 shadow-lg z-50 transform transition-transform duration-300 ease-in-out md:hidden ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                        <div className="p-4 flex justify-end">
                            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-md text-white hover:bg-gray-700">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <ul className="flex flex-col p-4 space-y-3">
                            {['dashboard', 'products', 'financialReport', 'productReport'].map((page) => (
                                <li key={page}>
                                    <button
                                        onClick={() => handlePageChange(page)}
                                        className={`w-full text-left px-4 py-2 rounded-lg transition-colors duration-300 ${currentPage === page ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-200 hover:bg-amber-500 hover:text-gray-900'}`}
                                    >
                                        {
                                            {
                                                'dashboard': 'Dashboard',
                                                'products': 'Produk & Stok',
                                                'financialReport': 'Keuangan',
                                                'productReport': 'Laporan'
                                            }[page]
                                        }
                                    </button>
                                </li>
                            ))}
                            <li>
                                <button
                                    onClick={() => window.open('https://astinhomeliving.com/', '_blank')}
                                    className="w-full text-left px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold shadow-md hover:bg-teal-700 transition-colors duration-300"
                                >
                                    AstinShop
                                </button>
                            </li>
                        </ul>
                    </nav>

                    {/* Konten Utama Aplikasi */}
                    <main className="flex-grow container mx-auto p-4 sm:p-6">
                        {currentPage === 'dashboard' && <Dashboard />}
                        {currentPage === 'products' && <ProductManagement />}
                        {currentPage === 'financialReport' && <FinancialReport />}
                        {currentPage === 'productReport' && <ProductReport />}
                    </main>

                    {/* Footer Aplikasi */}
                    <footer className="bg-gray-800 text-white p-4 text-center text-sm rounded-t-xl shadow-inner">
                        <div className="container mx-auto">
                            <p>&copy; 2025 DewaDigital.</p>
                            <p className="mt-1">ID Pengguna Anda: <span className="font-mono text-indigo-300 break-all">{userId}</span></p>
                        </div>
                    </footer>

                    {/* Custom Modal Render */}
                    <CustomModal
                        isOpen={showModal}
                        title={modalContent.title}
                        message={modalContent.message}
                        type={modalContent.type}
                        onConfirm={() => {
                            modalCallback(); // Panggil callback konfirmasi
                            setShowModal(false); // Tutup modal
                        }}
                        onCancel={() => setShowModal(false)} // Tutup modal saat batal
                    />
                </div>
            </FirebaseContext.Provider>
        );
    }

    // --- Dashboard Component ---
    function Dashboard() {
        const { userId, getProductsCollectionRef, getTransactionsCollectionRef } = useContext(FirebaseContext);
        const [products, setProducts] = useState([]);
        const [transactions, setTransactions] = useState([]);
        const [loading, setLoading] = useState(true);

        useEffect(() => {
            if (!userId) return;

            let productUnsubscribe;
            let transactionUnsubscribe;

            try {
                const productsRef = getProductsCollectionRef();
                productUnsubscribe = onSnapshot(productsRef, (snapshot) => {
                    const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setProducts(productsData);
                    setLoading(false);
                }, (error) => {
                    console.error("Error fetching products:", error)
                    setLoading(false);
                });

                const transactionsRef = getTransactionsCollectionRef();
                transactionUnsubscribe = onSnapshot(transactionsRef, (snapshot) => {
                    const transactionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Urutkan transaksi berdasarkan tanggal terbaru
                    transactionsData.sort((a, b) => new Date(b.date) - new Date(a.date));
                    setTransactions(transactionsData);
                }, (error) => {
                    console.error("Error fetching transactions:", error)
                });
            } catch(error) {
                console.error("Error setting up listeners:", error);
                setLoading(false);
            }

            // Cleanup function untuk menghentikan listener saat komponen di-unmount
            return () => {
                if (productUnsubscribe) productUnsubscribe();
                if (transactionUnsubscribe) transactionUnsubscribe();
            };
        }, [userId, getProductsCollectionRef, getTransactionsCollectionRef]); // Dependensi untuk re-run effect

        if (loading) {
            return <div className="text-center p-4 text-gray-400">Memuat data dashboard...</div>;
        }

        // Perhitungan nilai total stok, pemasukan, pengeluaran, dan saldo
        const totalStockValue = products.reduce((sum, product) => sum + (product.stock * product.priceBuy), 0);
        const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const currentBalance = totalIncome - totalExpense;
        const recentTransactions = transactions.slice(0, 5); // Ambil 5 transaksi terbaru

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Kartu Ringkasan Dashboard */}
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-indigo-400 mb-4">Total Produk</h2>
                    <p className="text-4xl font-bold text-gray-50">{products.length}</p>
                </div>
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-teal-400 mb-4">Nilai Stok Total</h2>
                    <p className="text-4xl font-bold text-gray-50">Rp {totalStockValue.toLocaleString('id-ID')}</p>
                </div>
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-purple-400 mb-4">Saldo Kas Saat Ini</h2>
                    <p className="text-4xl font-bold text-gray-50">Rp {currentBalance.toLocaleString('id-ID')}</p>
                </div>
                {/* Transaksi Terbaru */}
                <div className="lg:col-span-3 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-300 mb-4">Transaksi Terbaru</h2>
                    {recentTransactions.length > 0 ? (
                        <ul className="divide-y divide-gray-700">
                            {recentTransactions.map(t => (
                                <li key={t.id} className="py-3 flex justify-between items-center">
                                    <div>
                                        <p className="font-medium text-gray-200">{t.description}</p>
                                        <p className="text-sm text-gray-400">{new Date(t.date).toLocaleDateString('id-ID')}</p>
                                    </div>
                                    <p className={`font-semibold ${t.type === 'income' ? 'text-teal-400' : 'text-rose-400'}`}>
                                        {t.type === 'income' ? '+' : '-'} Rp {t.amount.toLocaleString('id-ID')}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-gray-400">Belum ada transaksi terbaru.</p>}
                </div>
            </div>
        );
    }


    // --- Product Management Component ---
    function ProductManagement() {
        // Mengambil instance storage, userId, dan fungsi showCustomModal dari FirebaseContext
        const { storage, userId, getProductsCollectionRef, showCustomModal } = useContext(FirebaseContext);
        const [products, setProducts] = useState([]);
        const [newProduct, setNewProduct] = useState({ name: '', description: '', priceBuy: '', priceSell: '', stock: '', imageUrl: 'https://placehold.co/100x100/374151/D1D5DB?text=Produk' });
        const [editingProduct, setEditingProduct] = useState(null);
        const [message, setMessage] = useState('');
        const [messageType, setMessageType] = useState('');
        const [uploadingImage, setLoadingImage] = useState(false);

        // Effect untuk mengambil data produk secara real-time dari Firestore
        useEffect(() => {
            if (!userId) return;
            const productsRef = getProductsCollectionRef();
            const unsubscribe = onSnapshot(productsRef, (snapshot) => {
                const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                productsData.sort((a, b) => a.name.localeCompare(b.name)); // Urutkan produk berdasarkan nama
                setProducts(productsData);
            }, (error) => showMessage(`Gagal memuat produk: ${error.message}`, "error"));
            return () => unsubscribe(); // Cleanup listener
        }, [userId, getProductsCollectionRef]);

        // Fungsi untuk menampilkan pesan notifikasi
        const showMessage = (text, type) => {
            setMessage(text);
            setMessageType(type);
            setTimeout(() => setMessage(''), 3000); // Pesan akan hilang setelah 3 detik
        };

        // Handler untuk perubahan input form
        const handleChange = (e) => {
            const { name, value } = e.target;
            setNewProduct(prev => ({ ...prev, [name]: value }));
        };

        // Handler untuk perubahan file gambar (upload ke Firebase Storage)
        const handleFileChange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                setLoadingImage(true); // Tampilkan indikator loading
                const storageRef = ref(storage, `product_images/${userId}/${file.name}_${Date.now()}`);
                try {
                    const snapshot = await uploadBytes(storageRef, file);
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    setNewProduct(prev => ({ ...prev, imageUrl: downloadURL }));
                    showMessage("Gambar berhasil diunggah!", "success");
                } catch (error) {
                    console.error("Error uploading image:", error);
                    showMessage("Gagal mengunggah gambar.", "error");
                } finally {
                    setLoadingImage(false); // Sembunyikan indikator loading
                }
            }
        };

        // Fungsi untuk mereset form
        const resetForm = () => {
            setNewProduct({ name: '', description: '', priceBuy: '', priceSell: '', stock: '', imageUrl: 'https://placehold.co/100x100/374151/D1D5DB?text=Produk' });
            setEditingProduct(null);
        };

        // Handler untuk submit form (tambah atau update produk)
        const handleSubmit = async (e) => {
            e.preventDefault();
            if (!newProduct.name || !newProduct.priceBuy || !newProduct.priceSell || !newProduct.stock) {
                return showMessage("Nama, Harga Beli, Harga Jual, dan Stok wajib diisi.", "error");
            }

            const productData = {
                ...newProduct,
                priceBuy: parseFloat(newProduct.priceBuy),
                priceSell: parseFloat(newProduct.priceSell),
                stock: parseInt(newProduct.stock),
                updatedAt: new Date().toISOString() // Catat waktu update
            };

            try {
                const productsRef = getProductsCollectionRef();
                if (editingProduct) {
                    // Update produk jika sedang dalam mode edit
                    const productDocRef = doc(productsRef, editingProduct);
                    await updateDoc(productDocRef, productData);
                    showMessage("Produk berhasil diperbarui!", "success");
                } else {
                    // Tambah produk baru
                    await addDoc(productsRef, { ...productData, createdAt: new Date().toISOString() }); // Catat waktu pembuatan
                    showMessage("Produk berhasil ditambahkan!", "success");
                }
                resetForm(); // Reset form setelah submit
            } catch (error) {
                console.error("Error saving product:", error);
                showMessage("Gagal menyimpan produk.", "error");
            }
        };

        // Handler untuk klik tombol edit
        const handleEditClick = (product) => {
            setEditingProduct(product.id);
            setNewProduct(product);
        };

        // Handler untuk menghapus produk (menggunakan modal kustom)
        const handleDeleteProduct = async (productId) => {
            showCustomModal(
                "Konfirmasi Hapus",
                "Apakah Anda yakin ingin menghapus produk ini? Tindakan ini tidak dapat dibatalkan.",
                "confirm",
                async () => { // Callback saat dikonfirmasi
                    try {
                        await deleteDoc(doc(getProductsCollectionRef(), productId));
                        showMessage("Produk berhasil dihapus!", "success");
                    } catch (error) {
                        console.error("Error deleting product:", error);
                        showMessage("Gagal menghapus produk.", "error");
                    }
                }
            );
        };

        // Handler untuk mengubah stok produk
        const handleStockChange = async (productId, change) => {
            const productToUpdate = products.find(p => p.id === productId);
            if (!productToUpdate) return;
            const newStock = productToUpdate.stock + change;
            if (newStock < 0) {
                showMessage("Stok tidak bisa kurang dari 0.", "error");
                return;
            }

            try {
                const productDocRef = doc(getProductsCollectionRef(), productId);
                await updateDoc(productDocRef, { stock: newStock, updatedAt: new Date().toISOString() });
            } catch (error) {
                console.error("Error updating stock:", error);
                showMessage("Gagal memperbarui stok.", "error");
            }
        };

        return (
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                <h2 className="text-2xl font-bold text-indigo-400 mb-6">Manajemen Produk & Stok</h2>
                {/* Pesan notifikasi */}
                {message && <div className={`p-3 mb-4 rounded-lg text-white ${messageType === 'success' ? 'bg-teal-600' : 'bg-rose-600'}`}>{message}</div>}

                {/* Form Tambah/Edit Produk */}
                <form onSubmit={handleSubmit} className="mb-8 p-6 border border-indigo-700 rounded-xl bg-gray-900 shadow-inner">
                    <h3 className="text-xl font-semibold text-indigo-400 mb-4">{editingProduct ? 'Edit Produk' : 'Tambah Produk Baru'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input name="name" value={newProduct.name} onChange={handleChange} placeholder="Nama Produk" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <textarea name="description" value={newProduct.description} onChange={handleChange} placeholder="Deskripsi" rows="2" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100"></textarea>
                        <input type="number" name="priceBuy" value={newProduct.priceBuy} onChange={handleChange} placeholder="Harga Beli (Rp)" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <input type="number" name="priceSell" value={newProduct.priceSell} onChange={handleChange} placeholder="Harga Jual (Rp)" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <input type="number" name="stock" value={newProduct.stock} onChange={handleChange} placeholder="Stok" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <div>
                            <label htmlFor="imageFile" className="block text-sm font-medium text-gray-300 mb-1">Unggah Gambar Produk</label>
                            <input type="file" id="imageFile" onChange={handleFileChange} className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" accept="image/*" />
                            {uploadingImage && <p className="text-sm text-indigo-400 mt-1">Mengunggah...</p>}
                            {newProduct.imageUrl && !uploadingImage && <img src={newProduct.imageUrl} alt="Pratinjau" className="w-24 h-24 mt-2 object-cover rounded-md" />}
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end space-x-3">
                        <button type="submit" className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700" disabled={uploadingImage}>
                            {editingProduct ? 'Perbarui' : 'Tambah'}
                        </button>
                        {editingProduct && <button type="button" onClick={resetForm} className="px-6 py-2 bg-gray-600 text-gray-200 font-semibold rounded-lg shadow-md hover:bg-gray-700">Batal</button>}
                    </div>
                </form>

                {/* Daftar Produk */}
                <h3 className="text-xl font-semibold text-gray-300 mb-4">Daftar Produk</h3>
                <div className="overflow-x-auto rounded-xl shadow-md border border-gray-700">
                    <table className="min-w-full bg-gray-900">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Gambar</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Nama</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Harga Beli</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Harga Jual</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Stok</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {products.map(product => (
                                <tr key={product.id} className="hover:bg-gray-700">
                                    <td className="py-3 px-4"><img src={product.imageUrl} alt={product.name} className="w-16 h-16 object-cover rounded-md" onError={(e) => { e.target.src = 'https://placehold.co/100x100/374151/D1D5DB?text=Error'; }} /></td>
                                    <td className="py-3 px-4 font-medium text-gray-100">{product.name}</td>
                                    <td className="py-3 px-4 text-gray-200">Rp {product.priceBuy.toLocaleString('id-ID')}</td>
                                    <td className="py-3 px-4 text-gray-200">Rp {product.priceSell.toLocaleString('id-ID')}</td>
                                    <td className="py-3 px-4">
                                        <div className="flex items-center space-x-2">
                                            <button onClick={() => handleStockChange(product.id, -1)} className="p-1.5 bg-rose-700 rounded-full hover:bg-rose-800">-</button>
                                            <span className="font-bold text-lg text-gray-100">{product.stock}</span>
                                            <button onClick={() => handleStockChange(product.id, 1)} className="p-1.5 bg-teal-700 rounded-full hover:bg-teal-800">+</button>
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <button onClick={() => handleEditClick(product)} className="text-indigo-400 hover:text-indigo-200 mr-3">Edit</button>
                                        <button onClick={() => handleDeleteProduct(product.id)} className="text-rose-400 hover:text-rose-200">Hapus</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }


    // --- Financial Report Component ---
    function FinancialReport() {
        // Mengambil userId, getTransactionsCollectionRef, dan fungsi showCustomModal dari FirebaseContext
        const { userId, getTransactionsCollectionRef, showCustomModal } = useContext(FirebaseContext);
        const [transactions, setTransactions] = useState([]);
        const [newTransaction, setNewTransaction] = useState({ date: new Date().toISOString().slice(0, 10), type: 'income', amount: '', description: '' });
        const [editingTransaction, setEditingTransaction] = useState(null);
        const [message, setMessage] = useState('');
        const [messageType, setMessageType] = useState('');
        const [filterPeriod, setFilterPeriod] = useState('monthly'); // Filter default: bulanan

        // Effect untuk mengambil data transaksi secara real-time dari Firestore
        useEffect(() => {
            if (!userId) return;
            const transactionsRef = getTransactionsCollectionRef();
            const unsubscribe = onSnapshot(transactionsRef, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                data.sort((a, b) => new Date(b.date) - new Date(a.date)); // Urutkan transaksi berdasarkan tanggal terbaru
                setTransactions(data);
            }, (error) => showMessage(`Gagal memuat transaksi: ${error.message}`, "error"));
            return () => unsubscribe(); // Cleanup listener
        }, [userId, getTransactionsCollectionRef]);

        // Fungsi untuk menampilkan pesan notifikasi
        const showMessage = (text, type) => {
            setMessage(text);
            setMessageType(type);
            setTimeout(() => setMessage(''), 3000);
        };

        // Handler untuk perubahan input form
        const handleChange = (e) => {
            const { name, value } = e.target;
            setNewTransaction(prev => ({ ...prev, [name]: value }));
        };

        // Fungsi untuk mereset form
        const resetForm = () => {
            setNewTransaction({ date: new Date().toISOString().slice(0, 10), type: 'income', amount: '', description: '' });
            setEditingTransaction(null);
        };

        // Handler untuk submit form (tambah atau update transaksi)
        const handleSubmit = async (e) => {
            e.preventDefault();
            if (!newTransaction.date || !newTransaction.amount || !newTransaction.description) {
                return showMessage("Tanggal, Jumlah, dan Deskripsi wajib diisi.", "error");
            }

            const transactionData = {
                ...newTransaction,
                amount: parseFloat(newTransaction.amount),
            };

            try {
                const transactionsRef = getTransactionsCollectionRef();
                if (editingTransaction) {
                    // Update transaksi jika sedang dalam mode edit
                    const docRef = doc(transactionsRef, editingTransaction);
                    await updateDoc(docRef, { ...transactionData, updatedAt: new Date().toISOString() });
                    showMessage("Transaksi berhasil diperbarui!", "success");
                } else {
                    // Tambah transaksi baru
                    await addDoc(transactionsRef, { ...transactionData, createdAt: new Date().toISOString() });
                    showMessage("Transaksi berhasil ditambahkan!", "success");
                }
                resetForm(); // Reset form setelah submit
            } catch (error) {
                console.error("Error saving transaction:", error);
                showMessage("Gagal menyimpan transaksi.", "error");
            }
        };

        // Handler untuk klik tombol edit
        const handleEditClick = (transaction) => {
            setEditingTransaction(transaction.id);
            setNewTransaction(transaction);
        };

        // Handler untuk menghapus transaksi (menggunakan modal kustom)
        const handleDeleteTransaction = async (transactionId) => {
            showCustomModal(
                "Konfirmasi Hapus",
                "Apakah Anda yakin ingin menghapus transaksi ini? Tindakan ini tidak dapat dibatalkan.",
                "confirm",
                async () => { // Callback saat dikonfirmasi
                    try {
                        await deleteDoc(doc(getTransactionsCollectionRef(), transactionId));
                        showMessage("Transaksi berhasil dihapap!", "success");
                    } catch (error) {
                        console.error("Error deleting transaction:", error);
                        showMessage("Gagal menghapus transaksi.", "error");
                    }
                }
            );
        };

        // Fungsi untuk memfilter transaksi berdasarkan periode waktu
        const filterTransactionsByPeriod = (data, period) => {
            const now = new Date();
            return data.filter(t => {
                const transactionDate = new Date(t.date);
                if (period === 'daily') return transactionDate.toDateString() === now.toDateString();
                if (period === 'monthly') return transactionDate.getMonth() === now.getMonth() && transactionDate.getFullYear() === now.getFullYear();
                if (period === 'yearly') return transactionDate.getFullYear() === now.getFullYear();
                return true; // Jika 'all', kembalikan semua transaksi
            });
        };

        // Filter transaksi berdasarkan periode yang dipilih
        const filteredTransactions = filterTransactionsByPeriod(transactions, filterPeriod);
        // Hitung ringkasan pemasukan, pengeluaran, dan profit
        const summary = filteredTransactions.reduce((acc, t) => {
            acc[t.type] = (acc[t.type] || 0) + t.amount;
            return acc;
        }, { income: 0, expense: 0 });
        summary.profit = summary.income - summary.expense;

        // Handler untuk ekspor data keuangan ke CSV
        const handleExportFinancialData = () => {
            const dataToExport = filteredTransactions.map(t => ({
                Tanggal: new Date(t.date).toLocaleDateString('id-ID'),
                Jenis: t.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
                Deskripsi: t.description,
                Jumlah: t.amount
            }));
            exportToCSV(dataToExport, `laporan_keuangan_${filterPeriod}_${new Date().toISOString().slice(0, 10)}.csv`, showCustomModal); // Teruskan showCustomModal
        };

        return (
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                <h2 className="text-2xl font-bold text-teal-400 mb-6">Laporan Keuangan</h2>
                {/* Pesan notifikasi */}
                {message && <div className={`p-3 mb-4 rounded-lg text-white ${messageType === 'success' ? 'bg-teal-600' : 'bg-rose-600'}`}>{message}</div>}

                {/* Form Tambah/Edit Transaksi */}
                <form onSubmit={handleSubmit} className="mb-8 p-6 border border-teal-700 rounded-xl bg-gray-900 shadow-inner">
                    <h3 className="text-xl font-semibold text-teal-400 mb-4">{editingTransaction ? 'Edit Transaksi' : 'Tambah Transaksi'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="date" name="date" value={newTransaction.date} onChange={handleChange} className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <select name="type" value={newTransaction.type} onChange={handleChange} className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100">
                            <option value="income">Pemasukan</option>
                            <option value="expense">Pengeluaran</option>
                        </select>
                        <input type="number" name="amount" value={newTransaction.amount} onChange={handleChange} placeholder="Jumlah (Rp)" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required />
                        <textarea name="description" value={newTransaction.description} onChange={handleChange} placeholder="Deskripsi" rows="2" className="w-full p-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100" required></textarea>
                    </div>
                    <div className="mt-6 flex justify-end space-x-3">
                        <button type="submit" className="px-6 py-2 bg-teal-600 text-white font-semibold rounded-lg shadow-md hover:bg-teal-700">{editingTransaction ? 'Perbarui' : 'Tambah'}</button>
                        {editingTransaction && <button type="button" onClick={resetForm} className="px-6 py-2 bg-gray-600 text-gray-200 font-semibold rounded-lg shadow-md hover:bg-gray-700">Batal</button>}
                    </div>
                </form>

                {/* Ringkasan Keuangan */}
                <div className="mb-8 p-6 border border-purple-700 rounded-xl bg-gray-900 shadow-inner">
                    <h3 className="text-xl font-semibold text-purple-400 mb-4">Ringkasan Keuangan</h3>
                    <div className="flex justify-center space-x-2 mb-4">
                        {/* Tombol filter periode */}
                        {['daily', 'monthly', 'yearly', 'all'].map(period => (
                            <button key={period} onClick={() => setFilterPeriod(period)} className={`px-4 py-2 rounded-lg transition-colors duration-300 ${filterPeriod === period ? 'bg-purple-600' : 'bg-purple-800'}`}>
                                {period.charAt(0).toUpperCase() + period.slice(1)}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                        <div className="p-4 bg-gray-800 rounded-lg"><p className="text-sm text-gray-400">Pemasukan</p><p className="text-2xl font-bold text-teal-400">Rp {summary.income.toLocaleString('id-ID')}</p></div>
                        <div className="p-4 bg-gray-800 rounded-lg"><p className="text-sm text-gray-400">Pengeluaran</p><p className="text-2xl font-bold text-rose-400">Rp {summary.expense.toLocaleString('id-ID')}</p></div>
                        <div className="p-4 bg-gray-800 rounded-lg"><p className="text-sm text-gray-400">Profit</p><p className={`text-2xl font-bold ${summary.profit >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>Rp {summary.profit.toLocaleString('id-ID')}</p></div>
                    </div>
                </div>

                {/* Daftar Transaksi */}
                <h3 className="text-xl font-semibold text-gray-300 mb-4">Daftar Transaksi</h3>
                <div className="overflow-x-auto rounded-xl shadow-md border border-gray-700">
                    <table className="min-w-full bg-gray-900">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Tanggal</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Jenis</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Deskripsi</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Jumlah</th>
                                <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {filteredTransactions.map(t => (
                                <tr key={t.id} className="hover:bg-gray-700">
                                    <td className="py-3 px-4 text-gray-200">{new Date(t.date).toLocaleDateString('id-ID')}</td>
                                    <td className="py-3 px-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${t.type === 'income' ? 'bg-teal-700 text-teal-100' : 'bg-rose-700 text-rose-100'}`}>{t.type}</span></td>
                                    <td className="py-3 px-4 text-gray-200">{t.description}</td>
                                    <td className={`py-3 px-4 font-semibold ${t.type === 'income' ? 'text-teal-400' : 'text-rose-400'}`}>Rp {t.amount.toLocaleString('id-ID')}</td>
                                    <td className="py-3 px-4 text-right">
                                        <button onClick={() => handleEditClick(t)} className="text-indigo-400 hover:text-indigo-200 mr-3">Edit</button>
                                        <button onClick={() => handleDeleteTransaction(t.id)} className="text-rose-400 hover:text-rose-200">Hapus</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="p-4 bg-gray-900 text-right rounded-b-xl border-t border-gray-700">
                        <button onClick={handleExportFinancialData} className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700">Ekspor Laporan</button>
                    </div>
                </div>
            </div>
        );
    }

    // --- Product Report Component ---
    function ProductReport() {
        // Mengambil userId, getProductsCollectionRef, dan fungsi showCustomModal dari FirebaseContext
        const { userId, getProductsCollectionRef, showCustomModal } = useContext(FirebaseContext);
        const [products, setProducts] = useState([]);
        const [loading, setLoading] = useState(true);

        // Effect untuk mengambil data produk secara real-time dari Firestore
        useEffect(() => {
            if (!userId) return;
            const productsRef = getProductsCollectionRef();
            const unsubscribe = onSnapshot(productsRef, (snapshot) => {
                const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                productsData.sort((a, b) => a.name.localeCompare(b.name)); // Urutkan produk berdasarkan nama
                setProducts(productsData);
                setLoading(false);
            }, (error) => console.error("Error fetching products:", error));
            return () => unsubscribe(); // Cleanup listener
        }, [userId, getProductsCollectionRef]);

        // Handler untuk ekspor data produk ke CSV
        const handleExportProductData = () => {
            const dataToExport = products.map(p => ({
                'Nama Produk': p.name,
                'Deskripsi': p.description,
                'Harga Beli': p.priceBuy,
                'Harga Jual': p.priceSell,
                'Stok': p.stock,
                'URL Gambar': p.imageUrl,
                'Dibuat Pada': p.createdAt ? new Date(p.createdAt).toLocaleString('id-ID') : 'N/A',
                'Diperbarui Pada': p.updatedAt ? new Date(p.updatedAt).toLocaleString('id-ID') : 'N/A'
            }));
            exportToCSV(dataToExport, `laporan_produk_${new Date().toISOString().slice(0, 10)}.csv`, showCustomModal); // Teruskan showCustomModal
        };

        if (loading) {
            return <div className="text-center p-4 text-gray-400">Memuat laporan produk...</div>;
        }

        // Data untuk grafik: nama produk dan stok
        const chartData = products.map(p => ({
            name: p.name,
            stock: p.stock
        }));

        return (
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                <h2 className="text-2xl font-bold text-indigo-400 mb-6">Laporan Produk/Gudang</h2>
                {products.length === 0 ? <p className="text-gray-400">Belum ada produk.</p> : (
                    <div className="overflow-x-auto rounded-xl shadow-md border border-gray-700">
                        <table className="min-w-full bg-gray-900">
                            <thead className="bg-gray-700">
                                <tr>
                                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Nama Produk</th>
                                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Harga Beli</th>
                                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Harga Jual</th>
                                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Stok</th>
                                    <th className="py-3 px-4 text-left text-xs font-medium text-gray-300 uppercase">Diperbarui</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {products.map(product => (
                                    <tr key={product.id} className="hover:bg-gray-700">
                                        <td className="py-3 px-4 font-medium text-gray-100">{product.name}</td>
                                        <td className="py-3 px-4 text-gray-200">Rp {product.priceBuy.toLocaleString('id-ID')}</td>
                                        <td className="py-3 px-4 text-gray-200">Rp {product.priceSell.toLocaleString('id-ID')}</td>
                                        <td className="py-3 px-4 text-gray-100">{product.stock}</td>
                                        <td className="py-3 px-4 text-sm text-gray-400">{product.updatedAt ? new Date(product.updatedAt).toLocaleDateString('id-ID') : 'N/A'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="p-4 bg-gray-900 text-right rounded-b-xl border-t border-gray-700">
                            <button onClick={handleExportProductData} className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700">
                                Ekspor Laporan Produk
                            </button>
                        </div>
                    </div>
                )}

                {/* Grafik Stok Produk */}
                <div className="mt-8 p-6 bg-gray-900 rounded-xl shadow-inner border border-gray-700">
                    <h3 className="text-xl font-semibold text-purple-400 mb-4">Grafik Stok Produk</h3>
                    {products.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart
                                data={chartData}
                                margin={{
                                    top: 20,
                                    right: 30,
                                    left: 20,
                                    bottom: 5,
                                }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                                <XAxis dataKey="name" stroke="#cbd5e0" tick={{ fill: '#cbd5e0', fontSize: 12 }} />
                                <YAxis stroke="#cbd5e0" tick={{ fill: '#cbd5e0', fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#2d3748', border: '1px solid #4a5568', borderRadius: '8px' }}
                                    labelStyle={{ color: '#a0aec0' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                />
                                <Legend wrapperStyle={{ color: '#a0aec0', paddingTop: '10px' }} />
                                <Bar dataKey="stock" fill="#8884d8" name="Stok Produk" />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-gray-400">Tidak ada data produk untuk ditampilkan dalam grafik.</p>
                    )}
                </div>
            </div>
        );
    }

    export default App;
