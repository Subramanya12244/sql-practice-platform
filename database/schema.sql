-- =============================================================================
-- Northwind-style practice database schema
-- Application metadata lives in a SEPARATE database (sql_practice).
-- =============================================================================

-- Roles (created by init script if missing)
-- sql_readonly: SELECT only on practice tables
-- sql_app: used for app DB only

CREATE TABLE IF NOT EXISTS categories (
    category_id   SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL,
    description   TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id   SERIAL PRIMARY KEY,
    company_name  VARCHAR(100) NOT NULL,
    contact_name  VARCHAR(100),
    contact_title VARCHAR(50),
    address       VARCHAR(100),
    city          VARCHAR(50),
    region        VARCHAR(50),
    postal_code   VARCHAR(20),
    country       VARCHAR(50),
    phone         VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS products (
    product_id        SERIAL PRIMARY KEY,
    product_name      VARCHAR(100) NOT NULL,
    supplier_id       INTEGER REFERENCES suppliers(supplier_id),
    category_id       INTEGER REFERENCES categories(category_id),
    quantity_per_unit VARCHAR(50),
    unit_price        NUMERIC(10, 2) DEFAULT 0,
    units_in_stock    INTEGER DEFAULT 0,
    units_on_order    INTEGER DEFAULT 0,
    reorder_level     INTEGER DEFAULT 0,
    discontinued      BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id   VARCHAR(10) PRIMARY KEY,
    company_name  VARCHAR(100) NOT NULL,
    contact_name  VARCHAR(100),
    contact_title VARCHAR(50),
    address       VARCHAR(100),
    city          VARCHAR(50),
    region        VARCHAR(50),
    postal_code   VARCHAR(20),
    country       VARCHAR(50),
    phone         VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS employees (
    employee_id   SERIAL PRIMARY KEY,
    last_name     VARCHAR(50) NOT NULL,
    first_name    VARCHAR(50) NOT NULL,
    title         VARCHAR(50),
    title_of_courtesy VARCHAR(20),
    birth_date    DATE,
    hire_date     DATE,
    address       VARCHAR(100),
    city          VARCHAR(50),
    region        VARCHAR(50),
    postal_code   VARCHAR(20),
    country       VARCHAR(50),
    home_phone    VARCHAR(30),
    reports_to    INTEGER REFERENCES employees(employee_id)
);

CREATE TABLE IF NOT EXISTS shippers (
    shipper_id   SERIAL PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    phone        VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS orders (
    order_id         SERIAL PRIMARY KEY,
    customer_id      VARCHAR(10) REFERENCES customers(customer_id),
    employee_id      INTEGER REFERENCES employees(employee_id),
    order_date       DATE,
    required_date    DATE,
    shipped_date     DATE,
    ship_via         INTEGER REFERENCES shippers(shipper_id),
    freight          NUMERIC(10, 2) DEFAULT 0,
    ship_name        VARCHAR(100),
    ship_address     VARCHAR(100),
    ship_city        VARCHAR(50),
    ship_region      VARCHAR(50),
    ship_postal_code  VARCHAR(20),
    ship_country     VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS order_details (
    order_id   INTEGER NOT NULL REFERENCES orders(order_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    quantity   INTEGER NOT NULL DEFAULT 1,
    discount   REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_employee ON orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_order_details_product ON order_details(product_id);
CREATE INDEX IF NOT EXISTS idx_employees_reports_to ON employees(reports_to);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
