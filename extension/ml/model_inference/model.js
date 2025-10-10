class ImageAdDetector {
    constructor() {
        this.adSets = {}; // Object to store ad sets by company
        this.normalImages = [];
        this.initialized = false;
        this.videoFrameInterval = 2000; // Check video frames every 2 seconds
        
        // Configure thresholds for different types of content
        this.thresholds = {
            normal: 0.25,    // Threshold for normal images
            stake: 0.55,     // Threshold for Stake ads
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

        // Calculate similarity (simple pixel comparison)
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

        const similarity = similarPixels / totalPixels;
        console.log("Image similarity score:", similarity);
        return similarity;
    }
}

// Export the class
window.ImageAdDetector = ImageAdDetector; 