const NotFound = () => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen text-center bg-slate-59">
        <img
            src="404_NotFound.png" 
            alt="not found" 
            className="max-w-full mb-6 w-96"
        />
        <p className="text-xl font-semibold">
            Bạn đang đi vào vùng cấm địa 🚫
        </p>
        <a href="/" className="inline-block px-6 py-3 font-medium text-white transition shadow-md bg-primary rounded-2xl hover:bg-primary-dark">Quay về trang chủ</a>
        </div>
    )
};

export default NotFound