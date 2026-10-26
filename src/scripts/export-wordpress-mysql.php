<?php
declare(strict_types=1);

ini_set('memory_limit', '1024M');
set_time_limit(0);

$opts = getopt('', ['out::', 'pretty']);
$out = $opts['out'] ?? (dirname(__DIR__, 2) . '/.data/wp-mysql-export.json');
$pretty = isset($opts['pretty']);

$dbName = getenv('WP_DB_NAME') ?: 'local';
$dbUser = getenv('WP_DB_USER') ?: 'root';
$dbPass = getenv('WP_DB_PASSWORD') ?: 'root';
$dbSocket = getenv('WP_DB_SOCKET') ?: '/home/talha/.config/Local/run/LNDDnRpKZ/mysql/mysqld.sock';
$prefix = getenv('WP_TABLE_PREFIX') ?: 'wp_';
$uploadsDir = getenv('WP_UPLOADS_DIR') ?: '/home/talha/Local Sites/tours-travel-finder/app/public/wp-content/uploads';

$m = new mysqli('localhost', $dbUser, $dbPass, $dbName, 0, $dbSocket);
if ($m->connect_errno) {
    fwrite(STDERR, "MySQL connection failed: {$m->connect_error}\n");
    exit(1);
}
$m->set_charset('utf8mb4');

function fetchAll(mysqli $m, string $sql): array
{
    $result = $m->query($sql);
    if ($result === false) {
        fwrite(STDERR, "Query failed: {$m->error}\n{$sql}\n");
        exit(1);
    }
    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = $row;
    }
    $result->free();
    return $rows;
}

function decodeValue(mixed $raw): mixed
{
    if ($raw === null || !is_string($raw)) {
        return $raw;
    }
    if ($raw === '') {
        return '';
    }
    if (preg_match('/^(a|s|i|d|b|O|N|C):/', $raw) === 1) {
        $decoded = @unserialize($raw, ['allowed_classes' => false]);
        if ($decoded !== false || $raw === 'b:0;') {
            return $decoded;
        }
    }
    $first = $raw[0];
    if ($first === '{' || $first === '[') {
        $decoded = json_decode($raw, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $decoded;
        }
    }
    return $raw;
}

function decodeRow(array $row, array $except = []): array
{
    $out = [];
    foreach ($row as $key => $value) {
        $out[$key] = in_array($key, $except, true) ? $value : decodeValue($value);
    }
    return $out;
}

function decodeHtml(string $value): string
{
    return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function parseIds(string $value): array
{
    $ids = [];
    foreach (explode(',', $value) as $part) {
        $id = (int) trim($part);
        if ($id > 0) {
            $ids[] = $id;
        }
    }
    return $ids;
}

$postTypes = ['product', 'post', 'page', 'top_destinations', 'top_attractions', 'shop_coupon', 'attachment'];
$postTypeSql = "'" . implode("','", array_map([$m, 'real_escape_string'], $postTypes)) . "'";

$postMeta = [];
$rows = fetchAll($m, "SELECT post_id, meta_key, meta_value FROM {$prefix}postmeta WHERE post_id IN (SELECT ID FROM {$prefix}posts WHERE post_type IN ({$postTypeSql}))");
foreach ($rows as $row) {
    $postId = (int) $row['post_id'];
    $key = $row['meta_key'];
    if (!array_key_exists($key, $postMeta[$postId] ?? [])) {
        $postMeta[$postId][$key] = decodeValue($row['meta_value']);
    }
}

$termMeta = [];
$rows = fetchAll($m, "SELECT term_id, meta_key, meta_value FROM {$prefix}termmeta");
foreach ($rows as $row) {
    $termId = (int) $row['term_id'];
    $termMeta[$termId][$row['meta_key']] = decodeValue($row['meta_value']);
}

$terms = [];
$termById = [];
$rows = fetchAll($m, "SELECT t.term_id, t.name, t.slug, tt.taxonomy, tt.description, tt.parent, tt.count FROM {$prefix}terms t JOIN {$prefix}term_taxonomy tt ON tt.term_id = t.term_id ORDER BY tt.taxonomy, tt.parent, t.name");
foreach ($rows as $row) {
    $item = [
        'id' => (int) $row['term_id'],
        'name' => decodeHtml($row['name']),
        'slug' => $row['slug'],
        'taxonomy' => $row['taxonomy'],
        'description' => decodeHtml((string) $row['description']),
        'parent' => (int) $row['parent'],
        'count' => (int) $row['count'],
        'meta' => $termMeta[(int) $row['term_id']] ?? [],
    ];
    $terms[$row['taxonomy']][] = $item;
    $termById[(int) $row['term_id']] = $item;
}

$termRelations = [];
$postTypeForIds = "'" . implode("','", array_map([$m, 'real_escape_string'], ['product', 'post', 'page'])) . "'";
$rows = fetchAll($m, "SELECT tr.object_id, tt.taxonomy, tt.term_id FROM {$prefix}term_relationships tr JOIN {$prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id WHERE tr.object_id IN (SELECT ID FROM {$prefix}posts WHERE post_type IN ({$postTypeForIds}))");
foreach ($rows as $row) {
    $objectId = (int) $row['object_id'];
    $termRelations[$objectId][$row['taxonomy']][] = (int) $row['term_id'];
}

$usermeta = [];
$rows = fetchAll($m, "SELECT user_id, meta_key, meta_value FROM {$prefix}usermeta WHERE meta_key IN ('wp_capabilities','first_name','last_name','nickname','description','billing_phone','billing_address_1','billing_address_2','billing_city','billing_state','billing_postcode','billing_country','shipping_address_1','shipping_address_2','shipping_city','shipping_state','shipping_postcode','shipping_country','locale')");
foreach ($rows as $row) {
    $usermeta[(int) $row['user_id']][$row['meta_key']] = decodeValue($row['meta_value']);
}

$users = [];
$rows = fetchAll($m, "SELECT ID, user_login, user_email, user_url, display_name, user_registered, user_status FROM {$prefix}users ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $usermeta[$id] ?? [];
    $caps = isset($meta['wp_capabilities']) && is_array($meta['wp_capabilities']) ? array_keys($meta['wp_capabilities']) : [];
    $users[] = [
        'id' => $id,
        'login' => $row['user_login'],
        'email' => $row['user_email'],
        'url' => $row['user_url'],
        'displayName' => decodeHtml($row['display_name']),
        'registered' => $row['user_registered'],
        'firstName' => (string) ($meta['first_name'] ?? ''),
        'lastName' => (string) ($meta['last_name'] ?? ''),
        'nickname' => (string) ($meta['nickname'] ?? ''),
        'description' => (string) ($meta['description'] ?? ''),
        'phone' => (string) ($meta['billing_phone'] ?? ''),
        'locale' => (string) ($meta['locale'] ?? ''),
        'roles' => $caps,
        'meta' => $meta,
    ];
}

$attachments = [];
$attachmentById = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_excerpt, post_name, post_mime_type, post_date, post_modified, post_parent, guid FROM {$prefix}posts WHERE post_type = 'attachment' ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $postMeta[$id] ?? [];
    $file = (string) ($meta['_wp_attached_file'] ?? '');
    if ($file === '') {
        continue;
    }
    $metadata = $meta['_wp_attachment_metadata'] ?? [];
    $width = is_array($metadata) ? (int) ($metadata['width'] ?? 0) : 0;
    $height = is_array($metadata) ? (int) ($metadata['height'] ?? 0) : 0;
    $absolute = rtrim($uploadsDir, '/') . '/' . ltrim($file, '/');
    $alt = (string) ($meta['_wp_attachment_image_alt'] ?? $row['post_excerpt']);
    $item = [
        'id' => $id,
        'title' => decodeHtml($row['post_title']),
        'file' => $file,
        'url' => '/media/wp/' . ltrim($file, '/'),
        'mimeType' => $row['post_mime_type'],
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'parent' => (int) $row['post_parent'],
        'alt' => decodeHtml($alt),
        'width' => $width,
        'height' => $height,
        'size' => is_file($absolute) ? filesize($absolute) : 0,
        'exists' => is_file($absolute),
    ];
    $attachments[] = $item;
    $attachmentById[$id] = $item;
}

$products = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_name, post_status, post_excerpt, post_content, post_date, post_modified, post_author, menu_order FROM {$prefix}posts WHERE post_type = 'product' AND post_status IN ('publish','draft','private','pending') ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $postMeta[$id] ?? [];
    $relations = $termRelations[$id] ?? [];
    $thumbnail = (int) ($meta['_thumbnail_id'] ?? 0);
    $gallery = parseIds((string) ($meta['_product_image_gallery'] ?? ''));
    $typeTerms = $relations['product_type'] ?? [];
    $type = 'simple';
    foreach ($typeTerms as $termId) {
        $slug = $termById[$termId]['slug'] ?? '';
        if (in_array($slug, ['variable', 'external', 'grouped', 'simple'], true)) {
            $type = $slug;
            break;
        }
    }
    $featured = false;
    foreach (($relations['product_visibility'] ?? []) as $termId) {
        if (($termById[$termId]['slug'] ?? '') === 'featured') {
            $featured = true;
        }
    }
    $products[] = [
        'id' => $id,
        'title' => decodeHtml($row['post_title']),
        'slug' => $row['post_name'],
        'status' => $row['post_status'],
        'excerpt' => decodeHtml($row['post_excerpt']),
        'content' => $row['post_content'],
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'authorId' => (int) $row['post_author'],
        'menuOrder' => (int) $row['menu_order'],
        'type' => $type,
        'isFeatured' => $featured,
        'meta' => $meta,
        'terms' => $relations,
        'thumbnailId' => $thumbnail,
        'galleryIds' => $gallery,
        'sku' => (string) ($meta['_sku'] ?? ''),
        'price' => (float) ($meta['_price'] ?? 0),
        'regularPrice' => (float) ($meta['_regular_price'] ?? 0),
        'salePrice' => (float) ($meta['_sale_price'] ?? 0),
        'stockStatus' => (string) ($meta['_stock_status'] ?? ''),
        'totalSales' => (int) ($meta['total_sales'] ?? 0),
        'averageRating' => (float) ($meta['_wc_average_rating'] ?? 0),
        'reviewCount' => (int) ($meta['_wc_review_count'] ?? 0),
        'ratingCounts' => $meta['_wc_rating_count'] ?? [],
    ];
}

$posts = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_name, post_status, post_excerpt, post_content, post_date, post_modified, post_author, comment_count FROM {$prefix}posts WHERE post_type = 'post' AND post_status IN ('publish','draft','private','pending') ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $postMeta[$id] ?? [];
    $posts[] = [
        'id' => $id,
        'title' => decodeHtml($row['post_title']),
        'slug' => $row['post_name'],
        'status' => $row['post_status'],
        'excerpt' => decodeHtml($row['post_excerpt']),
        'content' => $row['post_content'],
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'authorId' => (int) $row['post_author'],
        'commentCount' => (int) $row['comment_count'],
        'meta' => $meta,
        'terms' => $termRelations[$id] ?? [],
        'thumbnailId' => (int) ($meta['_thumbnail_id'] ?? 0),
    ];
}

$pages = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_name, post_status, post_excerpt, post_content, post_date, post_modified, post_author, menu_order FROM {$prefix}posts WHERE post_type = 'page' AND post_status IN ('publish','draft','private','pending') ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $postMeta[$id] ?? [];
    $pages[] = [
        'id' => $id,
        'title' => decodeHtml($row['post_title']),
        'slug' => $row['post_name'],
        'status' => $row['post_status'],
        'excerpt' => decodeHtml($row['post_excerpt']),
        'content' => $row['post_content'],
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'authorId' => (int) $row['post_author'],
        'menuOrder' => (int) $row['menu_order'],
        'meta' => $meta,
        'terms' => $termRelations[$id] ?? [],
        'thumbnailId' => (int) ($meta['_thumbnail_id'] ?? 0),
        'template' => (string) ($meta['_wp_page_template'] ?? 'default'),
        'selectedCategoryId' => (int) ($meta['_selected_category'] ?? 0),
        'selectedProductTagId' => (int) ($meta['_selected_product_tag'] ?? 0),
    ];
}

$showcases = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_name, post_type, post_status, post_excerpt, post_content, post_date, post_modified, post_author FROM {$prefix}posts WHERE post_type IN ('top_destinations','top_attractions') AND post_status IN ('publish','draft') ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $showcases[] = [
        'id' => $id,
        'kind' => $row['post_type'] === 'top_destinations' ? 'destination' : 'attraction',
        'title' => decodeHtml($row['post_title']),
        'slug' => $row['post_name'],
        'status' => $row['post_status'],
        'excerpt' => decodeHtml($row['post_excerpt']),
        'content' => $row['post_content'],
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'authorId' => (int) $row['post_author'],
        'meta' => $postMeta[$id] ?? [],
    ];
}

$addresses = [];
$rows = fetchAll($m, "SELECT * FROM {$prefix}wc_order_addresses ORDER BY order_id, address_type");
foreach ($rows as $row) {
    $orderId = (int) $row['order_id'];
    $addresses[$orderId][$row['address_type']] = decodeRow($row, ['order_id', 'address_type']);
}

$operational = [];
$rows = fetchAll($m, "SELECT * FROM {$prefix}wc_order_operational_data ORDER BY order_id");
foreach ($rows as $row) {
    $operational[(int) $row['order_id']] = decodeRow($row, ['order_id']);
}

$orderMeta = [];
$rows = fetchAll($m, "SELECT order_id, meta_key, meta_value FROM {$prefix}wc_orders_meta");
foreach ($rows as $row) {
    $orderId = (int) $row['order_id'];
    if (!array_key_exists($row['meta_key'], $orderMeta[$orderId] ?? [])) {
        $orderMeta[$orderId][$row['meta_key']] = decodeValue($row['meta_value']);
    }
}

$orderItems = [];
$rows = fetchAll($m, "SELECT order_item_id, order_item_name, order_item_type, order_id FROM {$prefix}woocommerce_order_items ORDER BY order_id, order_item_id");
foreach ($rows as $row) {
    $orderId = (int) $row['order_id'];
    $orderItems[$orderId][] = [
        'itemId' => (int) $row['order_item_id'],
        'name' => decodeHtml($row['order_item_name']),
        'type' => $row['order_item_type'],
        'meta' => [],
    ];
}

$itemMeta = [];
$rows = fetchAll($m, "SELECT order_item_id, meta_key, meta_value FROM {$prefix}woocommerce_order_itemmeta");
foreach ($rows as $row) {
    $itemMeta[(int) $row['order_item_id']][$row['meta_key']] = decodeValue($row['meta_value']);
}
foreach ($orderItems as &$items) {
    foreach ($items as &$item) {
        $item['meta'] = $itemMeta[$item['itemId']] ?? [];
    }
}
unset($items, $item);

$noteMeta = [];
$rows = fetchAll($m, "SELECT comment_id, meta_key, meta_value FROM {$prefix}commentmeta WHERE comment_id IN (SELECT comment_ID FROM {$prefix}comments WHERE comment_type = 'order_note')");
foreach ($rows as $row) {
    $noteMeta[(int) $row['comment_id']][$row['meta_key']] = decodeValue($row['meta_value']);
}

$orderNotes = [];
$rows = fetchAll($m, "SELECT comment_ID, comment_post_ID, comment_author, comment_content, comment_date, comment_approved FROM {$prefix}comments WHERE comment_type = 'order_note' ORDER BY comment_ID");
foreach ($rows as $row) {
    $orderNotes[(int) $row['comment_post_ID']][] = [
        'id' => (int) $row['comment_ID'],
        'author' => $row['comment_author'],
        'content' => decodeHtml($row['comment_content']),
        'date' => $row['comment_date'],
        'approved' => $row['comment_approved'],
        'meta' => $noteMeta[(int) $row['comment_ID']] ?? [],
    ];
}

$orders = [];
$rows = fetchAll($m, "SELECT id, status, currency, type, tax_amount, total_amount, customer_id, billing_email, date_created_gmt, date_updated_gmt, parent_order_id, payment_method, payment_method_title, transaction_id, ip_address, user_agent, customer_note FROM {$prefix}wc_orders ORDER BY id");
foreach ($rows as $row) {
    $id = (int) $row['id'];
    $orders[] = [
        'id' => $id,
        'status' => $row['status'],
        'currency' => $row['currency'],
        'type' => $row['type'],
        'taxAmount' => (float) $row['tax_amount'],
        'totalAmount' => (float) $row['total_amount'],
        'customerId' => (int) $row['customer_id'],
        'billingEmail' => $row['billing_email'],
        'dateCreated' => $row['date_created_gmt'],
        'dateUpdated' => $row['date_updated_gmt'],
        'parentOrderId' => (int) $row['parent_order_id'],
        'paymentMethod' => $row['payment_method'],
        'paymentMethodTitle' => decodeHtml((string) $row['payment_method_title']),
        'transactionId' => $row['transaction_id'],
        'ipAddress' => $row['ip_address'],
        'userAgent' => $row['user_agent'],
        'customerNote' => decodeHtml((string) $row['customer_note']),
        'addresses' => $addresses[$id] ?? [],
        'operational' => $operational[$id] ?? [],
        'meta' => $orderMeta[$id] ?? [],
        'items' => $orderItems[$id] ?? [],
        'notes' => $orderNotes[$id] ?? [],
    ];
}

$reviews = [];
$reviewMeta = [];
$rows = fetchAll($m, "SELECT comment_id, meta_key, meta_value FROM {$prefix}commentmeta WHERE comment_id IN (SELECT comment_ID FROM {$prefix}comments WHERE comment_type = 'review')");
foreach ($rows as $row) {
    $reviewMeta[(int) $row['comment_id']][$row['meta_key']] = decodeValue($row['meta_value']);
}
$rows = fetchAll($m, "SELECT comment_ID, comment_post_ID, comment_author, comment_author_email, comment_author_url, comment_author_IP, comment_date, comment_content, comment_approved, user_id FROM {$prefix}comments WHERE comment_type = 'review' ORDER BY comment_ID");
foreach ($rows as $row) {
    $id = (int) $row['comment_ID'];
    $reviews[] = [
        'id' => $id,
        'productId' => (int) $row['comment_post_ID'],
        'authorName' => decodeHtml($row['comment_author']),
        'authorEmail' => $row['comment_author_email'],
        'authorUrl' => $row['comment_author_url'],
        'authorIp' => $row['comment_author_IP'],
        'date' => $row['comment_date'],
        'content' => decodeHtml($row['comment_content']),
        'approved' => $row['comment_approved'],
        'userId' => (int) $row['user_id'],
        'rating' => (int) ($reviewMeta[$id]['rating'] ?? 5),
        'verified' => (int) ($reviewMeta[$id]['verified'] ?? 0) === 1,
        'meta' => $reviewMeta[$id] ?? [],
    ];
}

$fraudEvents = [];
$rows = fetchAll($m, "SELECT * FROM {$prefix}ttf_fraud_events ORDER BY id");
foreach ($rows as $row) {
    $fraudEvents[] = [
        'id' => (int) $row['id'],
        'eventType' => $row['event_type'],
        'orderId' => (int) ($row['order_id'] ?? 0),
        'status' => $row['status'],
        'riskScore' => (int) $row['risk_score'],
        'ipHash' => $row['ip_hash'],
        'emailHash' => $row['email_hash'],
        'phoneHash' => $row['phone_hash'],
        'fingerprintHash' => $row['fingerprint_hash'],
        'productKeys' => decodeValue($row['product_keys']),
        'reasons' => decodeValue($row['reasons']),
        'context' => decodeValue($row['context']),
        'createdAt' => $row['created_at'],
    ];
}

$coupons = [];
$rows = fetchAll($m, "SELECT ID, post_title, post_name, post_status, post_excerpt, post_content, post_date, post_modified FROM {$prefix}posts WHERE post_type = 'shop_coupon' ORDER BY ID");
foreach ($rows as $row) {
    $id = (int) $row['ID'];
    $meta = $postMeta[$id] ?? [];
    $coupons[] = [
        'id' => $id,
        'title' => decodeHtml($row['post_title']),
        'code' => $row['post_name'],
        'status' => $row['post_status'],
        'description' => decodeHtml($row['post_excerpt'] ?: $row['post_content']),
        'date' => $row['post_date'],
        'modified' => $row['post_modified'],
        'meta' => $meta,
    ];
}

$optionNames = [
    'blogname', 'blogdescription', 'admin_email', 'siteurl', 'home',
    'woocommerce_currency', 'woocommerce_currency_pos', 'woocommerce_price_num_decimals',
    'woocommerce_shop_page_id', 'woocommerce_cart_page_id', 'woocommerce_checkout_page_id',
    'woocommerce_myaccount_page_id', 'woocommerce_default_country', 'woocommerce_email_from_address',
    'ssl_zen_email', 'users_can_register', 'default_role',
    'ttf_fomo_enabled', 'ttf_fomo_entries', 'ttf_fraud_settings', 'ttf_promo_options',
    'ttf_cache_version',
];
$optionSql = "'" . implode("','", array_map([$m, 'real_escape_string'], $optionNames)) . "'";
$options = [];
$rows = fetchAll($m, "SELECT option_name, option_value FROM {$prefix}options WHERE option_name IN ({$optionSql})");
foreach ($rows as $row) {
    $options[$row['option_name']] = decodeValue($row['option_value']);
}

$export = [
    'meta' => [
        'exportedAt' => gmdate('c'),
        'database' => $dbName,
        'prefix' => $prefix,
        'siteUrl' => (string) ($options['siteurl'] ?? ''),
        'uploadsDir' => $uploadsDir,
        'counts' => [
            'terms' => array_map('count', $terms),
            'attachments' => count($attachments),
            'products' => count($products),
            'posts' => count($posts),
            'pages' => count($pages),
            'showcases' => count($showcases),
            'users' => count($users),
            'orders' => count($orders),
            'orderItems' => array_sum(array_map('count', $orderItems)),
            'reviews' => count($reviews),
            'fraudEvents' => count($fraudEvents),
            'coupons' => count($coupons),
        ],
    ],
    'options' => $options,
    'terms' => $terms,
    'users' => $users,
    'attachments' => $attachments,
    'products' => $products,
    'posts' => $posts,
    'pages' => $pages,
    'showcases' => $showcases,
    'orders' => $orders,
    'reviews' => $reviews,
    'fraudEvents' => $fraudEvents,
    'coupons' => $coupons,
];

$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
if ($pretty) {
    $flags |= JSON_PRETTY_PRINT;
}
$json = json_encode($export, $flags | JSON_INVALID_UTF8_SUBSTITUTE);
if ($json === false) {
    fwrite(STDERR, "JSON encoding failed: " . json_last_error_msg() . "\n");
    exit(1);
}
@mkdir(dirname($out), 0775, true);
if (file_put_contents($out, $json) === false) {
    fwrite(STDERR, "Could not write {$out}\n");
    exit(1);
}
echo json_encode(['ok' => true, 'out' => $out, 'bytes' => strlen($json), 'counts' => $export['meta']['counts']], JSON_PRETTY_PRINT) . "\n";
