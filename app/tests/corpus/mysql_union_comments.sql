SELECT order_id FROM t_demo_order
-- 注释夹在 UNION 中间
UNION ALL /* 保留重复行 */
SELECT refund_id FROM t_demo_refund;
