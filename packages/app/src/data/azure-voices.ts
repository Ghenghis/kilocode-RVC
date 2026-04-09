export interface AzureVoice {
	id: string
	locale: string
	name: string
	gender: "Female" | "Male"
}

export const AZURE_VOICES: AzureVoice[] = [
	// en-US
	{ id: "en-US-AvaNeural", locale: "en-US", name: "Ava (US)", gender: "Female" },
	{ id: "en-US-AndrewNeural", locale: "en-US", name: "Andrew (US)", gender: "Male" },
	{ id: "en-US-EmmaNeural", locale: "en-US", name: "Emma (US)", gender: "Female" },
	{ id: "en-US-BrianNeural", locale: "en-US", name: "Brian (US)", gender: "Male" },
	{ id: "en-US-JennyNeural", locale: "en-US", name: "Jenny (US)", gender: "Female" },
	{ id: "en-US-GuyNeural", locale: "en-US", name: "Guy (US)", gender: "Male" },
	{ id: "en-US-AriaNeural", locale: "en-US", name: "Aria (US)", gender: "Female" },
	{ id: "en-US-DavisNeural", locale: "en-US", name: "Davis (US)", gender: "Male" },
	{ id: "en-US-AmberNeural", locale: "en-US", name: "Amber (US)", gender: "Female" },
	{ id: "en-US-AnaNeural", locale: "en-US", name: "Ana (US)", gender: "Female" },
	{ id: "en-US-AshleyNeural", locale: "en-US", name: "Ashley (US)", gender: "Female" },
	{ id: "en-US-BrandonNeural", locale: "en-US", name: "Brandon (US)", gender: "Male" },
	{ id: "en-US-ChristopherNeural", locale: "en-US", name: "Christopher (US)", gender: "Male" },
	{ id: "en-US-CoraNeural", locale: "en-US", name: "Cora (US)", gender: "Female" },
	{ id: "en-US-ElizabethNeural", locale: "en-US", name: "Elizabeth (US)", gender: "Female" },
	{ id: "en-US-EricNeural", locale: "en-US", name: "Eric (US)", gender: "Male" },
	{ id: "en-US-JacobNeural", locale: "en-US", name: "Jacob (US)", gender: "Male" },
	{ id: "en-US-JaneNeural", locale: "en-US", name: "Jane (US)", gender: "Female" },
	{ id: "en-US-JasonNeural", locale: "en-US", name: "Jason (US)", gender: "Male" },
	{ id: "en-US-MichelleNeural", locale: "en-US", name: "Michelle (US)", gender: "Female" },
	{ id: "en-US-MonicaNeural", locale: "en-US", name: "Monica (US)", gender: "Female" },
	{ id: "en-US-NancyNeural", locale: "en-US", name: "Nancy (US)", gender: "Female" },
	{ id: "en-US-RogerNeural", locale: "en-US", name: "Roger (US)", gender: "Male" },
	{ id: "en-US-RyanNeural", locale: "en-US", name: "Ryan (US)", gender: "Male" },
	{ id: "en-US-SaraNeural", locale: "en-US", name: "Sara (US)", gender: "Female" },
	{ id: "en-US-SteffanNeural", locale: "en-US", name: "Steffan (US)", gender: "Male" },
	{ id: "en-US-TonyNeural", locale: "en-US", name: "Tony (US)", gender: "Male" },
	// en-GB
	{ id: "en-GB-SoniaNeural", locale: "en-GB", name: "Sonia (UK)", gender: "Female" },
	{ id: "en-GB-RyanNeural", locale: "en-GB", name: "Ryan (UK)", gender: "Male" },
	{ id: "en-GB-LibbyNeural", locale: "en-GB", name: "Libby (UK)", gender: "Female" },
	{ id: "en-GB-AbbiNeural", locale: "en-GB", name: "Abbi (UK)", gender: "Female" },
	{ id: "en-GB-AlfieNeural", locale: "en-GB", name: "Alfie (UK)", gender: "Male" },
	{ id: "en-GB-BellaNeural", locale: "en-GB", name: "Bella (UK)", gender: "Female" },
	{ id: "en-GB-ElliotNeural", locale: "en-GB", name: "Elliot (UK)", gender: "Male" },
	{ id: "en-GB-EthanNeural", locale: "en-GB", name: "Ethan (UK)", gender: "Male" },
	{ id: "en-GB-HollieNeural", locale: "en-GB", name: "Hollie (UK)", gender: "Female" },
	{ id: "en-GB-MaisieNeural", locale: "en-GB", name: "Maisie (UK)", gender: "Female" },
	{ id: "en-GB-NoahNeural", locale: "en-GB", name: "Noah (UK)", gender: "Male" },
	{ id: "en-GB-OliverNeural", locale: "en-GB", name: "Oliver (UK)", gender: "Male" },
	{ id: "en-GB-OliviaNeural", locale: "en-GB", name: "Olivia (UK)", gender: "Female" },
	{ id: "en-GB-ThomasNeural", locale: "en-GB", name: "Thomas (UK)", gender: "Male" },
	// en-AU
	{ id: "en-AU-NatashaNeural", locale: "en-AU", name: "Natasha (AU)", gender: "Female" },
	{ id: "en-AU-WilliamNeural", locale: "en-AU", name: "William (AU)", gender: "Male" },
	{ id: "en-AU-AnnetteNeural", locale: "en-AU", name: "Annette (AU)", gender: "Female" },
	{ id: "en-AU-CarlyNeural", locale: "en-AU", name: "Carly (AU)", gender: "Female" },
	{ id: "en-AU-DarrenNeural", locale: "en-AU", name: "Darren (AU)", gender: "Male" },
	{ id: "en-AU-DuncanNeural", locale: "en-AU", name: "Duncan (AU)", gender: "Male" },
	{ id: "en-AU-ElsieNeural", locale: "en-AU", name: "Elsie (AU)", gender: "Female" },
	{ id: "en-AU-FreyaNeural", locale: "en-AU", name: "Freya (AU)", gender: "Female" },
	{ id: "en-AU-JoanneNeural", locale: "en-AU", name: "Joanne (AU)", gender: "Female" },
	{ id: "en-AU-KenNeural", locale: "en-AU", name: "Ken (AU)", gender: "Male" },
	{ id: "en-AU-KimNeural", locale: "en-AU", name: "Kim (AU)", gender: "Female" },
	{ id: "en-AU-NeilNeural", locale: "en-AU", name: "Neil (AU)", gender: "Male" },
	{ id: "en-AU-TimNeural", locale: "en-AU", name: "Tim (AU)", gender: "Male" },
	{ id: "en-AU-TinaNeural", locale: "en-AU", name: "Tina (AU)", gender: "Female" },
	// en-CA
	{ id: "en-CA-ClaraNeural", locale: "en-CA", name: "Clara (CA)", gender: "Female" },
	{ id: "en-CA-LiamNeural", locale: "en-CA", name: "Liam (CA)", gender: "Male" },
	// en-IE
	{ id: "en-IE-ConnorNeural", locale: "en-IE", name: "Connor (IE)", gender: "Male" },
	{ id: "en-IE-EmilyNeural", locale: "en-IE", name: "Emily (IE)", gender: "Female" },
	// en-IN
	{ id: "en-IN-NeerjaNeural", locale: "en-IN", name: "Neerja (IN)", gender: "Female" },
	{ id: "en-IN-PrabhatNeural", locale: "en-IN", name: "Prabhat (IN)", gender: "Male" },
	{ id: "en-IN-AaravNeural", locale: "en-IN", name: "Aarav (IN)", gender: "Male" },
	{ id: "en-IN-AashiNeural", locale: "en-IN", name: "Aashi (IN)", gender: "Female" },
	{ id: "en-IN-AnanyaNeural", locale: "en-IN", name: "Ananya (IN)", gender: "Female" },
	{ id: "en-IN-KavyaNeural", locale: "en-IN", name: "Kavya (IN)", gender: "Female" },
	{ id: "en-IN-KunalNeural", locale: "en-IN", name: "Kunal (IN)", gender: "Male" },
	{ id: "en-IN-RehaanNeural", locale: "en-IN", name: "Rehaan (IN)", gender: "Male" },
	// en-NZ
	{ id: "en-NZ-MitchellNeural", locale: "en-NZ", name: "Mitchell (NZ)", gender: "Male" },
	{ id: "en-NZ-MollyNeural", locale: "en-NZ", name: "Molly (NZ)", gender: "Female" },
	// en-SG
	{ id: "en-SG-LunaNeural", locale: "en-SG", name: "Luna (SG)", gender: "Female" },
	{ id: "en-SG-WayneNeural", locale: "en-SG", name: "Wayne (SG)", gender: "Male" },
	// en-ZA
	{ id: "en-ZA-LeahNeural", locale: "en-ZA", name: "Leah (ZA)", gender: "Female" },
	{ id: "en-ZA-LukeNeural", locale: "en-ZA", name: "Luke (ZA)", gender: "Male" },
	// en-HK
	{ id: "en-HK-SamNeural", locale: "en-HK", name: "Sam (HK)", gender: "Male" },
	{ id: "en-HK-YanNeural", locale: "en-HK", name: "Yan (HK)", gender: "Female" },
	// en-KE
	{ id: "en-KE-AsiliaNeural", locale: "en-KE", name: "Asilia (KE)", gender: "Female" },
	{ id: "en-KE-ChilembaNeural", locale: "en-KE", name: "Chilemba (KE)", gender: "Male" },
	// en-NG
	{ id: "en-NG-AbeoNeural", locale: "en-NG", name: "Abeo (NG)", gender: "Male" },
	{ id: "en-NG-EzinneNeural", locale: "en-NG", name: "Ezinne (NG)", gender: "Female" },
	// en-PH
	{ id: "en-PH-JamesNeural", locale: "en-PH", name: "James (PH)", gender: "Male" },
	{ id: "en-PH-RosaNeural", locale: "en-PH", name: "Rosa (PH)", gender: "Female" },
	// en-TZ
	{ id: "en-TZ-ElimuNeural", locale: "en-TZ", name: "Elimu (TZ)", gender: "Male" },
	{ id: "en-TZ-ImaniNeural", locale: "en-TZ", name: "Imani (TZ)", gender: "Female" },
]

export const AZURE_LOCALES = [...new Set(AZURE_VOICES.map((v) => v.locale))].sort()
