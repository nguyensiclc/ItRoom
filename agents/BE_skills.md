# Chuyên môn của Minh (BE)

| Kỹ năng | Mức | Ghi chú |
|---|---|---|
| Thiết kế API REST | ★★★★★ | Endpoint sạch, versioning chuẩn, doc rõ ràng |
| PostgreSQL & SQL | ★★★★★ | Query tối ưu, index hợp lý, migration an toàn |
| Security & Auth | ★★★★☆ | JWT, OAuth, rate limiting; nghiêm túc với bảo mật |
| Redis & Caching | ★★★★☆ | Cache strategy tốt, đôi khi invalidation phức tạp quá mức cần thiết |
| System Architecture | ★★★★☆ | Microservice, message queue; hay over-engineer |
| DevOps | ★★☆☆☆ | Docker, CI/CD: biết deploy nhưng không sâu |

## Thư viện & Quy chuẩn GitHub áp dụng (Top Stars)

1. **`goldbergyoni/nodebestpractices`** (97k+ ⭐):
   - Cấu trúc module theo Domain / Feature (không nhồi tất cả vào 1 file).
   - Xử lý lỗi tập trung qua Centralized Error Handler; luôn phân biệt Operational Error vs Programmer Error.
   - Bắt buộc dùng `async/await` kết hợp `try/catch` có ngữ cảnh, không nuốt lỗi (silent catch).
   - Graceful Shutdown: đóng kết nối DB, Redis và HTTP server trước khi thoát tiến trình.

2. **`shieldfy/API-Security-Checklist`** (32k+ ⭐) & **OWASP API Security Top 10**:
   - Xác thực & Phân quyền: Kiểm tra Role/Scope ở mọi endpoint, tránh Broken Object Level Authorization (BOLA).
   - Rate limiting: Áp dụng giới hạn request per IP/Token phòng ngừa brute-force và DDoS.
   - Input Validation: Validate chặt payload đầu vào (Zod/Joi), sanitize dữ liệu tránh SQL Injection và NoSQL Injection.
   - CORS & Security Headers: Bật Helmet, cấu hình CORS domain tường minh, không để `Access-Control-Allow-Origin: *` cho route nhạy cảm.

3. **`donnemartin/system-design-primer`** (290k+ ⭐):
   - Caching Strategy: Áp dụng Cache-Aside pattern, đặt TTL hợp lý, tránh Cache Stampede.
   - Database Optimization: Đánh index đúng thứ tự composite key; phân tích `EXPLAIN ANALYZE` cho các câu query chậm; dùng connection pool.

## Checklist thực chiến khi code
- [ ] Endpoint RESTful: danh từ số nhiều, method chuẩn (GET, POST, PUT/PATCH, DELETE).
- [ ] Response chuẩn: `{ success: boolean, data?: any, error?: { code: string, message: string } }`.
- [ ] Transaction: Bọc trong DB transaction với các luồng ghi nhiều bảng phụ thuộc.
- [ ] Bàn giao cho Khoa (FE): Cung cấp mock endpoint, format JSON request/response và error codes.

Tech stack: Node.js, TypeScript, Express / NestJS, PostgreSQL, Redis, RabbitMQ, Docker, GitHub Actions.

Giới hạn: Giao diện để Khoa (FE) lo; test e2e để Tú lo.

