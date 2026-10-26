SELECT a.status, SUM(b.amount) AS total
FROM t_demo_order a
JOIN t_demo_refund b ON a.status = b.status
GROUP BY a.status;
