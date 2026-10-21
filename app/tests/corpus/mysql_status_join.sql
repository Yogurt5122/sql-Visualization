SELECT a.status, SUM(b.amount) AS total
FROM dwd_order a
JOIN dwd_refund b ON a.status = b.status
GROUP BY a.status;
