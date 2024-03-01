/*
 * Twilio - Api
 *
 * This is the public Twilio REST API.
 *
 * The version of the OpenAPI document: 1.55.0
 * Contact: support@twilio.com
 * Generated by: https://openapi-generator.tech
 */


/// 
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum TranscriptionEnumStatus {
    #[serde(rename = "in-progress")]
    InProgress,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,

}

impl ToString for TranscriptionEnumStatus {
    fn to_string(&self) -> String {
        match self {
            Self::InProgress => String::from("in-progress"),
            Self::Completed => String::from("completed"),
            Self::Failed => String::from("failed"),
        }
    }
}

impl Default for TranscriptionEnumStatus {
    fn default() -> TranscriptionEnumStatus {
        Self::InProgress
    }
}




