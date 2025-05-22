const axios = require('axios');

module.exports = async (req, res) => {
  const { ip, port } = req.query;
  
  if (!ip || !port) {
    return res.status(400).json({
      error: 'Both ip and port parameters are required'
    });
  }
  
  try {
    // This is just a placeholder - replace with your actual proxy checking logic
    // For now, we'll randomly determine if proxy is alive
    const isAlive = Math.random() > 0.5;
    
    if (isAlive) {
      res.json({
        ip,
        port: parseInt(port),
        proxyip: true,
        asOrganization: "Sample ISP",
        countryCode: "US",
        countryName: "United States",
        countryFlag: "🇺🇸",
        asn: 12345,
        colo: "DFW",
        httpProtocol: "HTTP/1.1",
        delay: "100 ms",
        latitude: "37.75100",
        longitude: "-97.82200",
        message: `Proxy Alive ${ip}:${port}`
      });
    } else {
      res.json({
        ip,
        port: parseInt(port),
        proxyip: false,
        asn: "Unknown",
        message: `Proxy Dead: ${ip}:${port}`
      });
    }
  } catch (error) {
    console.error('Error checking proxy:', error);
    res.status(500).json({
      error: 'Failed to check proxy'
    });
  }
};
