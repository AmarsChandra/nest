class ImageAdDetector {
    constructor() {
        this.adSets = {}; // Object to store ad sets by company
        this.normalImages = [];
        this.initialized = false;
        this.videoFrameInterval = 2000; // Check video frames every 2 seconds
        
        // Configure thresholds for different types of content
        this.thresholds = {
            normal: 0.25,    // Threshold for normal images
            stake: 0.35,     // Threshold for Stake ads (optimized for betting slips)
            default: 0.25    // Default threshold for any new company
        };
        
        console.log("ImageAdDetector constructor called");
    }

    async initialize() {
        try {
            console.log("Initializing ImageAdDetector...");
            
            // Load normal images
            const normalImageUrls = await this.getImageUrls('normal');
            console.log("Found normal image URLs:", normalImageUrls);
            this.normalImages = await Promise.all(normalImageUrls.map(url => this.loadImage(url)));
            console.log("Successfully loaded normal images:", this.normalImages.length);
            
            // Load ad sets for different companies
            const companies = ['stake']; // Add more companies as needed
            for (const company of companies) {
                const adImageUrls = await this.getImageUrls(`ads/${company}`);
                console.log(`Found ad image URLs for ${company}:`, adImageUrls);
                this.adSets[company] = await Promise.all(adImageUrls.map(url => this.loadImage(url)));
                console.log(`Successfully loaded ad images for ${company}:`, this.adSets[company].length);
            }
            
            this.initialized = true;
            console.log('Image ad detector initialized successfully');
        } catch (error) {
            console.error('Error initializing image ad detector:', error);
        }
    }

    async getImageUrls(folder) {
        try {
            console.log(`Loading image URLs from ${folder} folder...`);
            const response = await fetch(chrome.runtime.getURL(`ml/image_database/${folder}/index.json`));
            const data = await response.json();
            console.log(`Found ${data.images.length} images in ${folder} index.json`);
            return data.images.map(img => chrome.runtime.getURL(`ml/image_database/${folder}/${img}`));
        } catch (error) {
            console.error(`Error loading ${folder} image URLs:`, error);
            return [];
        }
    }

    async loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                console.log(`Successfully loaded image: ${url}`);
                resolve(img);
            };
            img.onerror = (error) => {
                console.error(`Error loading image ${url}:`, error);
                reject(error);
            };
            img.src = url;
        });
    }

    async predict(tweetElement) {
        if (!this.initialized) {
            console.log("Detector not initialized, initializing now...");
            await this.initialize();
        }

        try {
            // Check for images
            const tweetImages = await this.getTweetImages(tweetElement);
            console.log(`Found ${tweetImages.length} images in tweet`);
            
            // Only check first image for speed
            if (tweetImages.length > 0) {
                const tweetImg = tweetImages[0];
                
                // First check against normal images
                console.log("Checking against normal images...");
                let maxNormalSimilarity = 0;
                for (const normalImg of this.normalImages) {
                    const similarity = await this.compareImages(tweetImg, normalImg);
                    maxNormalSimilarity = Math.max(maxNormalSimilarity, similarity);
                    if (similarity > this.thresholds.normal) {
                        console.log("Found matching normal image! Similarity score:", similarity);
                        return { isAd: false, company: null };
                    }
                }
                console.log("Max similarity with normal images:", maxNormalSimilarity);
                
                // If not normal, check against ad sets for each company
                console.log("Checking against ad sets...");
                for (const [company, adImages] of Object.entries(this.adSets)) {
                    console.log(`Checking ${company} ads...`);
                    let maxAdSimilarity = 0;
                    for (const adImg of adImages) {
                        const similarity = await this.compareImages(tweetImg, adImg);
                        maxAdSimilarity = Math.max(maxAdSimilarity, similarity);
                        // Use company-specific threshold or default if not specified
                        const threshold = this.thresholds[company] || this.thresholds.default;
                        if (similarity > threshold) {
                            console.log(`Found matching ad image for ${company}! Similarity score:`, similarity);
                            return { isAd: true, company };
                        }
                    }
                    console.log(`Max similarity with ${company} ads:`, maxAdSimilarity);
                }
            }

            // Only check videos if no images found
            if (tweetImages.length === 0) {
                const videos = tweetElement.querySelectorAll('video');
                if (videos.length > 0) {
                    console.log(`Found ${videos.length} videos in tweet`);
                    // Only check first video for speed
                    const videoResult = await this.checkVideoForAds(videos[0]);
                    if (videoResult.isAd) {
                        console.log(`Found ad in video for ${videoResult.company}!`);
                        return videoResult;
                    }
                }
            }

            console.log("No matching ads found in tweet");
            return { isAd: false, company: null };
        } catch (error) {
            console.error('Error predicting tweet:', error);
            return { isAd: false, company: null };
        }
    }

    async getTweetImages(tweetElement) {
        const images = [];
        const imgElements = tweetElement.querySelectorAll('img[src*="media"]');
        console.log("Found img elements in tweet:", imgElements.length);
        
        for (const imgElement of imgElements) {
            try {
                console.log("Processing image:", imgElement.src);
                const img = await this.loadImage(imgElement.src);
                console.log("Successfully loaded tweet image:", imgElement.src);
                images.push(img);
            } catch (error) {
                console.error('Error loading tweet image:', error);
            }
        }
        
        return images;
    }

    async checkVideoForAds(video) {
        return new Promise((resolve) => {
            // Create canvas for video frame capture
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set canvas size to a smaller size for faster processing
            const targetWidth = 200;
            const targetHeight = 200;
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            // Function to check current video frame
            const checkFrame = async () => {
                try {
                    // Draw current video frame to canvas
                    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
                    
                    // Create temporary image from canvas
                    const frameImage = new Image();
                    frameImage.src = canvas.toDataURL();
                    
                    // Wait for image to load
                    await new Promise(resolve => {
                        frameImage.onload = resolve;
                    });

                    // Compare frame with ad sets for each company
                    for (const [company, adImages] of Object.entries(this.adSets)) {
                        for (const adImg of adImages) {
                            const similarity = await this.compareImages(frameImage, adImg);
                            if (similarity > 0.25) {
                                console.log(`Found matching ad in video frame for ${company}!`);
                                resolve({ isAd: true, company });
                                return;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error checking video frame:', error);
                }
            };

            // Check first frame immediately
            checkFrame().then(result => {
                if (result && result.isAd) {
                    resolve(result);
                    return;
                }

                // If first frame didn't match, check periodically
                const interval = setInterval(async () => {
                    if (video.ended || video.paused) {
                        clearInterval(interval);
                        resolve({ isAd: false, company: null });
                    } else {
                        const result = await checkFrame();
                        if (result && result.isAd) {
                            clearInterval(interval);
                            resolve(result);
                        }
                    }
                }, this.videoFrameInterval);

                // Stop checking after 5 seconds
                setTimeout(() => {
                    clearInterval(interval);
                    resolve({ isAd: false, company: null });
                }, 5000);
            });
        });
    }

    async compareImages(img1, img2) {
        console.log("Comparing images...");
        console.log("Image 1 dimensions:", img1.width, "x", img1.height);
        console.log("Image 2 dimensions:", img2.width, "x", img2.height);

        // Create canvas elements
        const canvas1 = document.createElement('canvas');
        const canvas2 = document.createElement('canvas');
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');

        // Set canvas dimensions to a smaller size for faster comparison
        const targetWidth = 200; // Reduced size for faster processing
        const targetHeight = 200;
        canvas1.width = targetWidth;
        canvas1.height = targetHeight;
        canvas2.width = targetWidth;
        canvas2.height = targetHeight;

        // Draw images scaled to smaller size
        ctx1.drawImage(img1, 0, 0, targetWidth, targetHeight);
        ctx2.drawImage(img2, 0, 0, targetWidth, targetHeight);

        // Get image data
        const data1 = ctx1.getImageData(0, 0, targetWidth, targetHeight).data;
        const data2 = ctx2.getImageData(0, 0, targetWidth, targetHeight).data;

        // Calculate multiple similarity metrics
        const pixelSimilarity = this.calculatePixelSimilarity(data1, data2);
        const structuralSimilarity = this.calculateStructuralSimilarity(data1, data2, targetWidth, targetHeight);
        const colorDistributionSimilarity = this.calculateColorDistribution(data1, data2);

        // Weight the different similarity measures
        const weightedSimilarity = (
            pixelSimilarity * 0.4 +
            structuralSimilarity * 0.4 +
            colorDistributionSimilarity * 0.2
        );

        console.log("Pixel similarity:", pixelSimilarity);
        console.log("Structural similarity:", structuralSimilarity);
        console.log("Color distribution similarity:", colorDistributionSimilarity);
        console.log("Weighted similarity score:", weightedSimilarity);
        return weightedSimilarity;
    }

    calculatePixelSimilarity(data1, data2) {
        let similarPixels = 0;
        let totalPixels = 0;

        // Sample pixels instead of checking every one
        const sampleRate = 4; // Check every 4th pixel
        for (let i = 0; i < data1.length; i += 4 * sampleRate) {
            const r1 = data1[i];
            const g1 = data1[i + 1];
            const b1 = data1[i + 2];
            const r2 = data2[i];
            const g2 = data2[i + 1];
            const b2 = data2[i + 2];

            // Calculate color difference
            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            
            // Check if pixel is likely part of the background (very dark or very light)
            const brightness1 = r1 + g1 + b1;
            const brightness2 = r2 + g2 + b2;
            const isBackground1 = brightness1 < 100 || brightness1 > 600;
            const isBackground2 = brightness2 < 100 || brightness2 > 600;
            
            if (isBackground1 || isBackground2) {
                if (diff < 150) {
                    similarPixels++;
                }
            } else {
                if (diff < 80) {
                    similarPixels++;
                }
            }
            totalPixels++;
        }

        return similarPixels / totalPixels;
    }

    calculateStructuralSimilarity(data1, data2, width, height) {
        // Look for similar edge patterns and layout structures
        let structuralMatches = 0;
        let totalChecks = 0;

        // Check for similar horizontal and vertical lines (UI elements)
        const step = 8;
        for (let y = 0; y < height - step; y += step) {
            for (let x = 0; x < width - step; x += step) {
                const edge1 = this.detectEdges(data1, x, y, step, width);
                const edge2 = this.detectEdges(data2, x, y, step, width);
                
                if (Math.abs(edge1 - edge2) < 0.3) {
                    structuralMatches++;
                }
                totalChecks++;
            }
        }

        return structuralMatches / totalChecks;
    }

    detectEdges(data, x, y, size, width) {
        let edgeStrength = 0;
        for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
                const idx = ((y + dy) * width + (x + dx)) * 4;
                if (idx < data.length) {
                    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    edgeStrength += brightness;
                }
            }
        }
        return edgeStrength / (size * size * 255);
    }

    calculateColorDistribution(data1, data2) {
        // Compare color histograms to detect similar color schemes
        const histogram1 = this.calculateHistogram(data1);
        const histogram2 = this.calculateHistogram(data2);
        
        let intersection = 0;
        let union = 0;
        
        for (let i = 0; i < histogram1.length; i++) {
            intersection += Math.min(histogram1[i], histogram2[i]);
            union += Math.max(histogram1[i], histogram2[i]);
        }
        
        return union > 0 ? intersection / union : 0;
    }

    calculateHistogram(data) {
        const histogram = new Array(32).fill(0); // Simplified color histogram
        for (let i = 0; i < data.length; i += 4) {
            const r = Math.floor(data[i] / 8);
            const g = Math.floor(data[i + 1] / 8);
            const b = Math.floor(data[i + 2] / 8);
            const index = r * 64 + g * 8 + b;
            histogram[Math.floor(index / 32)]++;
        }
        return histogram;
    }
}

// Export the class
window.ImageAdDetector = ImageAdDetector; 